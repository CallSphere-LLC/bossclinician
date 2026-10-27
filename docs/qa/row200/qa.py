#!/usr/bin/env python3
"""Row200 guarded QA helper. Production mutations require a separate parent authorization."""
import argparse, hashlib, json, os, secrets, subprocess
from pathlib import Path
from urllib.parse import urlencode

ROOT = Path(__file__).resolve().parent
parser = argparse.ArgumentParser()
parser.add_argument("action", choices=["preflight", "fixture", "link", "audit", "cleanup", "readback"])
parser.add_argument("--who", choices=["a", "b"])
parser.add_argument("--execute-authorized", action="store_true")
parser.add_argument("--record", default="/var/tmp/bc200-qa-manifest.json")
args = parser.parse_args()
record = Path(args.record)
EMAILS = ["bc-qa-200-20261027-a@example.invalid", "bc-qa-200-20261027-b@example.invalid"]
container = os.environ.get("BC200_PG_CONTAINER", "bossclinician-db-1")
user = os.environ.get("BC200_PG_USER", "boss")
database = os.environ.get("BC200_PG_DATABASE", "bossclinician")

def db(sql, variables=None):
    command = ["docker", "exec", "-i", container, "psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-U", user, "-d", database]
    for key,value in (variables or {}).items():
        command += ["-v", key + "=" + str(value)]
    result = subprocess.run(command, input=sql, text=True, capture_output=True)
    if result.stderr:
        print(result.stderr.strip())
    if result.returncode:
        raise SystemExit("STOP: database guard/query failed; no automatic retry or workflow disabling.")
    return result.stdout.strip()

def authorized():
    if not args.execute_authorized:
        raise SystemExit("Prepared only. Parent must authorize this action, then pass --execute-authorized.")
def preflight():
    print(db((ROOT / "preflight.sql").read_text()))
def save(value):
    fd = os.open(record, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd,"w") as output:
        json.dump(value,output,indent=2)
    os.chmod(record,0o600)
def manifest():
    value = json.loads(record.read_text())
    if value.get("target") != [container,user,database]:
        raise SystemExit("STOP: manifest database target differs")
    rows = sorted(value["members"],key=lambda row:row["email"])
    if [row["email"] for row in rows] != EMAILS or any(type(row["id"]) is not int or row["id"]<=0 for row in rows):
        raise SystemExit("STOP: unexpected manifest IDs/emails")
    return value, rows

if args.action == "preflight":
    preflight()
elif args.action == "fixture":
    authorized()
    if record.exists():
        raise SystemExit("STOP: manifest already exists; inspect before provisioning")
    preflight()
    value = json.loads(db((ROOT / "fixture.sql").read_text()))
    value["target"] = [container,user,database]
    save(value)
    print("Created only 2 QA members + product44 grants (2 hours); IDs:", [row["id"] for row in value["members"]])
elif args.action == "link":
    authorized()
    if not args.who: raise SystemExit("--who a|b required")
    preflight()
    value,rows = manifest()
    row=rows[0 if args.who=="a" else 1]
    token=secrets.token_urlsafe(32)
    digest=hashlib.sha256(token.encode()).hexdigest()
    result=db(f"""BEGIN;
      INSERT INTO member_magic_links(member_id,token_hash,purpose,expires_at)
      SELECT id,'{digest}','host',now()+interval '120 seconds' FROM members
      WHERE id={row['id']} AND email='{row['email']}'
      RETURNING member_id;
      COMMIT;""")
    if result != str(row["id"]): raise SystemExit("STOP: member no longer matches manifest")
    value.setdefault("links",{})[args.who]="https://www.bossclinician.com/host-link?"+urlencode({
        "token":token,"next":"/library/the-boss-move/lessons/start-here-welcome-to-the-boss-clinician-club-program"})
    save(value)
    print("One-use QA link stored in mode0600 manifest; expires in120 seconds. No email sent.")
elif args.action in ("audit","cleanup"):
    if args.action=="cleanup": authorized()
    value,rows=manifest()
    print(db((ROOT/"cleanup.sql").read_text(), {
        "member_a":rows[0]["id"],"member_b":rows[1]["id"],"execute_cleanup":"true" if args.action=="cleanup" else "false"}))
    if args.action=="cleanup":
        value.pop("links",None)
        value["cleanupCompleted"]=True
        save(value)
elif args.action=="readback":
    value,rows=manifest()
    ids=",".join(str(row["id"]) for row in rows)
    email_sql=",".join("'"+email+"'" for email in EMAILS)
    print(db(f"""BEGIN READ ONLY;
      SELECT 'members',count(*) FROM members WHERE id IN ({ids}) OR email IN ({email_sql})
      UNION ALL SELECT 'contacts',count(*) FROM contacts WHERE email IN ({email_sql})
      UNION ALL SELECT 'submissions',count(*) FROM form_submissions WHERE member_id IN ({ids}) OR email IN ({email_sql})
      UNION ALL SELECT 'events',count(*) FROM domain_events WHERE email IN ({email_sql})
      UNION ALL SELECT 'jobs_with_qa_email',count(*) FROM jobs WHERE {" OR ".join("payload::text LIKE '%"+email+"%'" for email in EMAILS)};
      ROLLBACK;"""))

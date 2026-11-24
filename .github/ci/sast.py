"""Run a pinned, offline Semgrep CE scan; block high findings and scanner errors."""
import collections
import json
import os
from pathlib import Path
import subprocess
import sys

IMAGE = "semgrep/semgrep@sha256:6e1b04340e60e910fbb4ddbf3c857ab0918f064417ad5ac530014ccb3cf8c8f1"

def blocking(report):
    findings = [item for item in report["results"]
                if item["extra"]["severity"].upper() in {"ERROR", "HIGH", "CRITICAL"}]
    errors = [item for item in report["errors"] if item.get("level") != "warn"]
    return findings, errors

def main():
    root = Path.cwd().resolve()
    output = root / ".ci-reports"
    output.mkdir(mode=0o700, exist_ok=True)
    result = output / "semgrep.json"
    result.unlink(missing_ok=True)
    security_options = json.loads(subprocess.check_output(
        ["docker", "info", "--format", "{{json .SecurityOptions}}"], text=True))
    # Root inside rootless Docker maps to the unprivileged runner on the host.
    rootless = any("rootless" in option for option in security_options)
    identity = "0:0" if rootless else f"{os.getuid()}:{os.getgid()}"
    command = ["docker", "run", "--rm", "--network", "none", "--cpus", "2", "--memory", "3g",
               "--user", identity, "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
               "--pids-limit", "256", "-e", "HOME=/tmp",
               "-v", f"{root}:/src:ro", "-v", f"{output}:/report", "-w", "/src", IMAGE,
               "semgrep", "scan", "--oss-only", "--metrics", "off", "--disable-version-check",
               "--config", "/src/.github/ci/sast-rules/ci.yaml", "--config",
               "/src/.github/ci/sast-rules/github-actions.yaml", "--jobs", "2", "--max-memory", "2048",
               "--timeout", "20", "--exclude", ".github/ci/sast-rules", "--exclude", ".ci-reports", "--json", "--output", "/report/semgrep.json"]
    subprocess.run(command, check=True)
    report = json.loads(result.read_text())
    findings, errors = blocking(report)
    counts = collections.Counter(item["extra"]["severity"] for item in report["results"])
    summary = (f"Semgrep CE: {len(report['paths']['scanned'])} files scanned; "
               f"{len(findings)} blocking findings, {len(errors)} scanner errors; "
               f"severity counts {dict(counts)}.\n")
    print(summary)
    for item in findings:
        print(f"BLOCK: {item['check_id']} {item['path']}:{item['start']['line']}")
    for item in errors:
        print(f"SCAN ERROR: {item.get('type')} {item.get('path', '')}")
    if os.getenv("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as stream:
            stream.write("### Static security scan\n" + summary +
                         "Warnings and partial-parser diagnostics remain in the private report. "
                         "This is Semgrep Community Edition, not CodeQL or a complete security audit.\n")
    return int(bool(findings or errors))

if __name__ == "__main__":
    sys.exit(main())

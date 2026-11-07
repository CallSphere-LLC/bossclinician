#!/usr/bin/env python3
"""Scan every release image before import; retain all findings on encrypted disk."""
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys

if os.geteuid() != 0 or len(sys.argv) != 2:
    raise SystemExit("Run as root with the release identifier.")
release = sys.argv[1]
if not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,90}", release):
    raise SystemExit("Invalid release identifier.")
trivy = shutil.which("trivy")
if not trivy:
    raise SystemExit("Trivy is required before deployment.")
subprocess.run(["mountpoint", "-q", "/var/lib/postgresql"], check=True)
os.umask(0o077)
work = Path("/var/lib/postgresql/security-release-scans/boss") / release
work.mkdir(parents=True, exist_ok=False)
cache = work.parent / "cache"
cache.mkdir(exist_ok=True)
summary = []
for component in ("backend", "frontend", "ai", "gateway"):
    image = f"bossclinician-k3-{component}:{release}"
    report = work / f"{component}.json"
    subprocess.run([trivy, "image", "--cache-dir", str(cache),
                    "--cache-backend", "memory", "--scanners", "vuln",
                    "--severity", "HIGH,CRITICAL", "--image-src", "docker",
                    "--format", "json", "--output", str(report), image], check=True)
    data = json.loads(report.read_text())
    findings = [v for r in data.get("Results", []) for v in r.get("Vulnerabilities", [])]
    fixable = [v for v in findings if v.get("FixedVersion")]
    summary.append({"component": component, "image": image,
                    "imageID": data.get("Metadata", {}).get("ImageID"),
                    "critical": sum(v["Severity"] == "CRITICAL" for v in findings),
                    "high": sum(v["Severity"] == "HIGH" for v in findings),
                    "fixableCriticalHigh": len(fixable)})
(work / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
if any(row["fixableCriticalHigh"] for row in summary):
    raise SystemExit(f"Release blocked: fixable high/critical vulnerabilities. Evidence: {work}")
print(f"Release security check passed; complete findings: {work}")

# Dedicated admin origin infrastructure — 12 September 2026

Provisioned `admin.bossclinician.callsphere.site` for the security follow-up. DNS and TLS are ready; application origin isolation is verified separately after the root deployment.

- Authoritative provider: Hostinger (`aster.dns-parking.com`, `helios.dns-parking.com`). The existing scoped Hostinger API credential could read and update the `callsphere.site` zone.
- Created exactly one A record, relative name `admin.bossclinician`, target `192.99.63.81`, TTL 300, with append semantics (`overwrite: false`). Both authoritative nameservers and Cloudflare's public resolver returned the target.
- Compared all 34 preexisting DNS RRsets before/after: names, types, TTLs and record values were unchanged. The provider reordered the existing two CAA values, without changing their content.
- Applied auth agent's `k8s/admin-ingress.yaml`: `boss-admin-http` and `boss-admin-https`, namespace `bossclinician`, both pointing to the existing isolated `boss-web` service.
- cert-manager `bossclinician-admin-tls` reached Ready=True through the existing `letsencrypt-prod` HTTP-01 issuer.
- Live TLS: subject/SAN `admin.bossclinician.callsphere.site`, issuer Let's Encrypt YR2, valid 12 September 2026 18:55:38 GMT through 11 December 2026 18:55:37 GMT. OpenSSL `-verify_return_error` returned **Verification: OK / code 0**.
- A normal HTTPS GET at 19:54:23 UTC, with full certificate verification enabled, returned HTTP 200. This was before the application/nginx deployment, so the body still contained the public app. This check establishes DNS/TLS reachability only, not final admin isolation.

No app deployment, nginx reload, certificate/private-key disclosure or existing DNS modification was performed by this infrastructure lane. No blocker remains for root's application deployment.

Evidence is in `/tmp/boss-bughunt/dns-zone-before.json`, `dns-zone-after.json`, `admin-origin-headers.txt` and `admin-origin-before-deploy.html`. The DNS helper reads the provider credential only in process memory; no credential is embedded in the helper or report.

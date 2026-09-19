# Direct K3s release verification

Released `20260919183929-f736b5f` directly from the complete working checkout on 2026-09-19. Git did not trigger or supply the deployment. The source manifest includes tracked and untracked application, service, infrastructure and script files; its SHA256 is `1bfe0709be4c20665d87ca8c5bde149386f65fe6180181bb60d453a41316512a`. All four runtime images carry that same source label, and the working checkout matched it after cutover.

- Backend API/SSR, frontend, AI and gateway use immutable release tags. Both deployments are ready with zero restarts. Three public health reads returned the exact release; the admin page returned HTTP 200.
- Public routing has one EndpointSlice targeting the new app pod `10.42.0.87:8080`; the legacy host endpoint is gone. Old Compose nginx, backend, frontend and AI containers are stopped. Postgres, coturn and the private database bridge remain running.
- The original database container `d37e9c0bb00123d6cb7f23d2dccaaed4acd96fe5e16d005f98b4a90525d02962` and data volumes remain in place. Existing public/protected upload mounts were checked using temporary write/read probes from both runtimes, then cleaned up.
- A pre-migration custom-format PostgreSQL backup exists at `/var/backups/bossclinician/pre-k3s-20260919183929-f736b5f.dump`. `pg_restore --list` succeeded with 1,541 catalog lines; no restore was performed against production.
- Scoped retention removed eight obsolete Boss image references plus a disposable oldest-tag probe from each image store. Before/after inventories confirmed every unrelated image reference remained. Current and two rollback releases are retained, along with any image referenced by workloads or containers. Three newer probe tags were protected as expected and then explicitly cleaned up. No volumes or shared build caches were pruned.
- The daily `bossclinician-image-prune.timer` is enabled and active. Deployment also runs retention after successful public health verification.
- Deployment/retention tests: 109 passed. Backend real-database integration: 285 passed; the subsequently added native-history test was covered by a focused rerun of all 17 member-side integration cases. Root and other agents retain separate browser/provider, frontend and backend unit-test evidence.

Exact image IDs, source labels, pods, routing, container identities and retention readbacks are in [k3s-deployment.json](k3s-deployment.json). The immutable full source manifest remains at `/var/lib/bossclinician/releases/20260919183929-f736b5f/source-manifest.json` on the deployment host.

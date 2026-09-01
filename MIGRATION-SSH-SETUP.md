# Granting this server SSH access to server-64gbRam (192.99.63.81)

## Why this step is needed
This box (`srv1588736`) had **no** `~/.ssh/id_ed25519` — that key lives on your laptop, not here.
So a fresh migration-only keypair was generated here, and `~/.ssh/config` now has the
`server-64gbRam` host entry. The new server just needs to trust the new public key.

## Run this ONCE from your laptop (the machine that already has id_ed25519)

```bash
ssh -i ~/.ssh/id_ed25519 ubuntu@192.99.63.81 \
  'mkdir -p ~/.ssh && chmod 700 ~/.ssh && echo "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIHHMMTWvqS7FPxeUtiCfB9SQvrHs7CjMYIYxn/HnDynn bossclinician-migration@srv1588736" >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys && sort -u ~/.ssh/authorized_keys -o ~/.ssh/authorized_keys'
```

If your laptop can't reach it either, paste that public key into the OVH/Hostinger
console for 192.99.63.81 under the `ubuntu` user's authorized_keys.

## Then verify (I can run this myself once the key is in place)

```bash
ssh server-64gbRam 'hostname; free -g; df -h /; docker ps'
```

## What comes next, after access works
1. Inventory what actually runs here (containers, images, volumes, .env files, nginx/caddy, certs, cron).
2. Snapshot the Postgres/DB data — dump, don't copy live files.
3. rsync the repo + volumes over (this host is 8GB/2-core and runs live containers, so
   throttle with `--bwlimit` and do it serially — see the "server RAM is tight" constraint).
4. Bring the stack up on the 64GB box with the SAME env, smoke-test on its IP/port
   BEFORE any DNS move.
5. Cut DNS over last. Stripe is in LIVE mode — no test charges during verification.

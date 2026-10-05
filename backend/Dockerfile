# Boss Clinician backend — Node 24 + Express + TypeScript + Postgres
#
# The build context is the repository root, not backend/, because this image
# also carries the server-rendering build of the React app: the public marketing
# pages are rendered to HTML here, and the API process is the only part of the
# system that can read the database directly. Seed data still ships as a bundled
# copy at src/seed/data/content.json, so nothing else is needed at build time.

# ---- The app, built for a server ----
# Two outputs: dist/client/index.html is the document shell (with the hashed
# asset tags the browser bundle needs) and dist/server/ is the CommonJS render
# bundle. Only those two travel into the runtime image; the browser assets
# themselves are served by the frontend container from its own build of the same
# source, which produces byte-identical, content-hashed filenames.
FROM node:24-alpine AS frontend
WORKDIR /app
# The registry is fetched on every image build, and one dropped connection used
# to fail `npm install` outright and, with it, the CI that gates a production
# deploy (14 Sep 2026: "npm error network" on a GitHub runner). Retry with
# backoff instead; a registry that is really down still fails, after ~5 minutes.
ENV npm_config_fetch_retries=5 \
    npm_config_fetch_retry_mintimeout=20000 \
    npm_config_fetch_retry_maxtimeout=120000
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install
COPY frontend/ ./

ARG VITE_API_BASE=/api
ENV VITE_API_BASE=${VITE_API_BASE}
# Publishable key only — safe to bake into the browser bundle.
ARG VITE_STRIPE_PUBLISHABLE_KEY=
ENV VITE_STRIPE_PUBLISHABLE_KEY=${VITE_STRIPE_PUBLISHABLE_KEY}

# Same cap as frontend/Dockerfile, for the same reason: this box is shared with
# several other applications and a k3s cluster, and an unbounded Vite build is
# the thing most likely to OOM the host rather than fail cleanly.
ENV NODE_OPTIONS=--max-old-space-size=1536
RUN npm run build

# ---- The API ----
FROM node:24-alpine AS build
WORKDIR /app
# Same registry retries as the frontend stage above.
ENV npm_config_fetch_retries=5 \
    npm_config_fetch_retry_mintimeout=20000 \
    npm_config_fetch_retry_maxtimeout=120000
COPY backend/package*.json ./
RUN npm install
COPY backend/ ./
ENV NODE_OPTIONS=--max-old-space-size=1024
RUN npm run build

FROM node:24-alpine AS api
# Public helper and its private glibc runtime only; credentials are mounted at runtime.
COPY --from=aws_identity_helper /aws_signing_helper /ld-linux-x86-64.so.2 /libc.so.6 /libresolv.so.2 /opt/aws-helper-runtime/
COPY --from=aws_identity_helper /credential-helper /usr/local/bin/aws_signing_helper
RUN echo '566ad51bc14497f0a6860327ed8f4353ef0ca20c316fc29e85e4083cb127535d  /opt/aws-helper-runtime/aws_signing_helper' | sha256sum -c - \
    && echo 'bda779ea9e9ad234f60315477d7cfd0bdde861cd8ddd9df8cdaf62f18c4cec14  /opt/aws-helper-runtime/ld-linux-x86-64.so.2' | sha256sum -c - \
    && echo '85e64f97e348786a8fb4d9f3d52fec289e2fb86bba20f0731dfe61990525e0f7  /opt/aws-helper-runtime/libc.so.6' | sha256sum -c - \
    && echo '6b99ecf94bcb81732ed1e81615084a5cfe7383eb89ce83106fa51077409ce609  /opt/aws-helper-runtime/libresolv.so.2' | sha256sum -c - \
    && echo '31a22fd8a6a7350dbc8fd044483fe1513b5fd695690d45ecf3d18283a7cbefcd  /usr/local/bin/aws_signing_helper' | sha256sum -c - \
    && chmod 0755 /usr/local/bin/aws_signing_helper /opt/aws-helper-runtime/* \
    && /usr/local/bin/aws_signing_helper version
WORKDIR /app
# Same registry retries as the frontend stage above.
ENV npm_config_fetch_retries=5 \
    npm_config_fetch_retry_mintimeout=20000 \
    npm_config_fetch_retry_maxtimeout=120000
ENV NODE_ENV=production
# Below the container's memory cap on purpose. V8 sizes its heap from what the
# host reports, not from the cgroup, so without this it will happily grow past
# the limit and be OOM-killed by the kernel instead of collecting garbage — the
# process dies with no stack and no warning. Keep the two numbers in step: this
# should stay roughly two thirds of the memory limit in docker-compose.yml.
ENV NODE_OPTIONS=--max-old-space-size=640
COPY backend/package*.json ./
RUN npm install --omit=dev \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
COPY --from=build /app/dist ./dist

# The render bundle and the document shell, in the layout `vite build` produces.
ENV SSR_DIST_DIR=/app/frontend-dist
COPY --from=frontend /app/dist/server ./frontend-dist/server
COPY --from=frontend /app/dist/client/index.html ./frontend-dist/client/index.html

# Operational scripts run against the live database from inside this container
# (regenerating the nginx redirect map, for one), so they have to ship with it.
COPY backend/scripts ./scripts
# Both storage roots exist in the image so the volumes mounted over them inherit
# this ownership. A directory Docker creates for a missing mount point belongs to
# root, and the `node` user below could not write an upload into it.
RUN mkdir -p /app/uploads /app/uploads-protected && chown -R node:node /app

# The commit this image was built from, reported by /api/health so a deploy can
# prove the live API is the build it just rolled out. Declared last: a new value
# every commit then costs one metadata layer, not a rebuild of the layers above.
ARG APP_RELEASE=dev
ENV APP_RELEASE=${APP_RELEASE}

# Run as the built-in non-root `node` user (uid 1000). CMD invokes the node
# binary directly (on PATH), so the non-root HOME change doesn't break startup.
USER node

EXPOSE 4000
CMD ["node", "dist/server.js"]

# ---- The browser bundle, served by its own nginx ----
# Deliberately the *same* `frontend` stage the API image copies from, rather
# than a second Dockerfile with its own npm install and vite build.
#
# Two reasons, both of which had bitten this deploy. Memory: the images are
# built on the server that serves the site — 8GB, two cores, k3s and a live
# Postgres already resident — and `docker compose build` builds services in
# parallel, so two Vite builds of the same 230-file app ran at once and put the
# host within a few hundred megabytes of the OOM killer, which would have
# reached for Postgres or a k3s pod, not for the build. Correctness: the
# server-rendered document shell baked into the API image names the browser
# bundle by its content hash, and the file it names has to be the file this
# container actually holds. One build cannot disagree with itself.
FROM nginx:1.31-alpine AS web
COPY --from=frontend /app/dist/client /usr/share/nginx/html
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80

# Security baseline: writable runtime state is confined to /tmp/nginx.
RUN apk upgrade --no-cache && sed -i '/^user[[:space:]]/d; s@pid[[:space:]]*[^;]*;@pid /tmp/nginx/nginx.pid;@' /etc/nginx/nginx.conf \
    && sed -i '/http {/a\    client_body_temp_path /tmp/nginx/client_temp;\n    proxy_temp_path /tmp/nginx/proxy_temp;\n    fastcgi_temp_path /tmp/nginx/fastcgi_temp;\n    uwsgi_temp_path /tmp/nginx/uwsgi_temp;\n    scgi_temp_path /tmp/nginx/scgi_temp;' /etc/nginx/nginx.conf \
    && mkdir -p /tmp/nginx && chown -R 101:101 /tmp/nginx
USER 101:101
ENTRYPOINT ["nginx"]
CMD ["-g", "daemon off;"]

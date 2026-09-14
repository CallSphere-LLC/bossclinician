# Boss Clinician backend — Node 20 + Express + TypeScript + Postgres
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
FROM node:20-alpine AS frontend
WORKDIR /app
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
FROM node:20-alpine AS build
WORKDIR /app
COPY backend/package*.json ./
RUN npm install
COPY backend/ ./
ENV NODE_OPTIONS=--max-old-space-size=1024
RUN npm run build

FROM node:20-alpine AS api
WORKDIR /app
ENV NODE_ENV=production
# Below the container's memory cap on purpose. V8 sizes its heap from what the
# host reports, not from the cgroup, so without this it will happily grow past
# the limit and be OOM-killed by the kernel instead of collecting garbage — the
# process dies with no stack and no warning. Keep the two numbers in step: this
# should stay roughly two thirds of the memory limit in docker-compose.yml.
ENV NODE_OPTIONS=--max-old-space-size=640
COPY backend/package*.json ./
RUN npm install --omit=dev
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
FROM nginx:1.27-alpine AS web
COPY --from=frontend /app/dist/client /usr/share/nginx/html
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80

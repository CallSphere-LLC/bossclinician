# Boss Clinician backend — Node 20 + Express + TypeScript + Postgres
# Self-contained: build context is this directory (backend/). Seed data ships
# as a bundled copy at src/seed/data/content.json, so no sibling directories
# are required at build time.

FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
ENV NODE_OPTIONS=--max-old-space-size=1024
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
# Below the container's 768M cap on purpose. V8 sizes its heap from what the
# host reports, not from the cgroup, so without this it will happily grow past
# the limit and be OOM-killed by the kernel instead of collecting garbage — the
# process dies with no stack and no warning. Keep the two numbers in step: this
# should stay roughly two thirds of the memory limit in docker-compose.yml.
ENV NODE_OPTIONS=--max-old-space-size=512
COPY package*.json ./
RUN npm install --omit=dev
COPY --from=build /app/dist ./dist
# Operational scripts run against the live database from inside this container
# (regenerating the nginx redirect map, for one), so they have to ship with it.
COPY scripts ./scripts
# Both storage roots exist in the image so the volumes mounted over them inherit
# this ownership. A directory Docker creates for a missing mount point belongs to
# root, and the `node` user below could not write an upload into it.
RUN mkdir -p /app/uploads /app/uploads-protected && chown -R node:node /app

# Run as the built-in non-root `node` user (uid 1000). CMD invokes the node
# binary directly (on PATH), so the non-root HOME change doesn't break startup.
USER node

EXPOSE 4000
CMD ["node", "dist/server.js"]

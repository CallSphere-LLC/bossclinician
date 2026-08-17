# ---- Build stage ----
FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY . .

ARG VITE_API_BASE=/api
ENV VITE_API_BASE=${VITE_API_BASE}

# Publishable key only — safe to bake into the browser bundle.
ARG VITE_STRIPE_PUBLISHABLE_KEY=
ENV VITE_STRIPE_PUBLISHABLE_KEY=${VITE_STRIPE_PUBLISHABLE_KEY}

# Cap the build's heap. Vite/rollup on a 230-file app will happily grow past a
# gigabyte, and this box is shared with several other applications and a k3s
# cluster — an unbounded build is the thing most likely to OOM the host rather
# than fail cleanly. 1536MB is comfortably above what this app needs; if a build
# starts dying here the answer is to look at what got large, not to raise it.
ENV NODE_OPTIONS=--max-old-space-size=1536
RUN npm run build

# ---- Runtime stage ----
FROM nginx:1.27-alpine AS runtime

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]

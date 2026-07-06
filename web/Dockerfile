# syntax=docker/dockerfile:1
# ── IRIS web image: build the SPA, serve it via nginx + reverse-proxy /api ────
# Build context is the REPO ROOT (the web build needs @iris/shared too).

FROM node:20-bookworm AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci
COPY tsconfig.base.json ./
COPY shared/ shared/
COPY web/ web/
RUN npm run build:shared && npm run build:web

FROM nginx:1.27-alpine AS runtime
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/web/dist /usr/share/nginx/html
EXPOSE 80

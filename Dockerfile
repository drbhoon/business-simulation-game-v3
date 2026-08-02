# ─── Build client and server ─────────────────────────────────────────────────
FROM node:20-bookworm-slim AS builder
WORKDIR /app

# sqlite3 ships prebuilt binaries but falls back to node-gyp on some platforms,
# so keep a toolchain available for the install step.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package.json ./
COPY client/package.json client/package-lock.json ./client/
COPY server/package.json server/package-lock.json ./server/

RUN npm install --prefix client --no-audit --no-fund \
    && npm install --prefix server --no-audit --no-fund

COPY . .

# Vite bakes `base` into the built asset URLs, so the prefix has to be present
# at build time; the server reads it again at runtime (see below).
ARG BASE_PATH=""
ENV BASE_PATH=$BASE_PATH
RUN npm run build --prefix client && npm run build --prefix server

# ─── Runtime ─────────────────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production
ARG BASE_PATH=""
ENV BASE_PATH=$BASE_PATH

# The game stores state in SQLite. The default in production is /tmp/game.db,
# which does not survive a restart — point it at a mounted volume instead.
ENV DATABASE_FILE_PATH=/data/game.db

COPY --from=builder /app/server/node_modules ./server/node_modules
COPY --from=builder /app/server/dist ./server/dist
COPY --from=builder /app/client/dist ./client/dist
COPY package.json ./

RUN mkdir -p /data

EXPOSE 3000

# initDb.js is idempotent (CREATE TABLE IF NOT EXISTS), so a fresh volume
# provisions itself and an existing one is left alone.
CMD ["sh", "-c", "node server/dist/scripts/initDb.js && node server/dist/index.js"]

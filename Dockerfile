# syntax=docker/dockerfile:1
#
# Production image for the Personal Management Dashboard (spec §20).
#
# Phase 0 note: the "worker" process (background jobs, reminders, sync) is added
# in Phase 3 as a second service; this file already builds for a non-root user,
# standalone output and a persistent /app/data volume.

FROM node:24-bookworm-slim AS deps
WORKDIR /app
# Lockfile-driven, reproducible install. --ignore-scripts keeps the build free of
# a Python/node-gyp toolchain: better-sqlite3 ships prebuilt binaries for
# linux-x64/linux-arm64 and the runner stage verifies the binding actually loads.
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
  npm ci --ignore-scripts --no-audit --no-fund \
  --fetch-retries=5 --fetch-retry-maxtimeout=120000 --fetch-timeout=600000

FROM node:24-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY tsconfig.json next.config.ts postcss.config.mjs drizzle.config.ts ./
COPY next-env.d.ts ./
COPY public ./public
COPY drizzle ./drizzle
COPY src ./src
COPY scripts ./scripts
RUN npm run build

FROM node:24-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=4000 \
    DEFAULT_LANGUAGE=he \
    DEFAULT_TIMEZONE=Asia/Jerusalem \
    NEXT_TELEMETRY_DISABLED=1 \
    DATABASE_PATH=./data/app.db

RUN groupadd --system --gid 1001 nodejs \
 && useradd --system --uid 1001 --gid nodejs --home /app nextjs

# The data directory must already exist with the runtime user's ownership,
# otherwise a fresh named volume (created from this directory) is root-owned and
# the app cannot create the SQLite file. Verified by `docker compose up` + healthcheck.
RUN mkdir -p /app/data && chown -R nextjs:nodejs /app/data

# Standalone server + its traced dependencies (includes better-sqlite3 native
# binding for this image's platform) + the migration files it applies on start.
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=nextjs:nodejs /app/public ./public
COPY --from=build --chown=nextjs:nodejs /app/scripts ./scripts

# Prove the native SQLite binding for THIS image platform works before the image
# is considered usable: real in-memory database, real pragmas, real query.
RUN node -e "const D=require('better-sqlite3');const db=new D(':memory:');db.pragma('journal_mode = WAL');db.pragma('foreign_keys = 1');db.exec('CREATE TABLE t(a INTEGER PRIMARY KEY, b TEXT NOT NULL)');db.prepare('INSERT INTO t (b) VALUES (?)').run('ok');const n=db.prepare('SELECT COUNT(*) AS c FROM t').get().c;if(n!==1)throw new Error('native sqlite verification failed');console.log('better-sqlite3 binding ok, sqlite',db.prepare('SELECT sqlite_version() AS v').get().v);db.close();"

USER nextjs
EXPOSE 4000

VOLUME ["/app/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "scripts/healthcheck.mjs"]

CMD ["node", "server.js"]

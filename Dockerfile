# syntax=docker/dockerfile:1

# ── Build: install everything, build the SPA and the server bundle ─────────────
FROM node:26-alpine AS build
# better-sqlite3's install compiles from source when no prebuilt binary matches.
RUN apk add --no-cache python3 make g++
# Node 25+ no longer ships corepack; pin pnpm to package.json's packageManager.
RUN npm install -g pnpm@10.33.1
WORKDIR /app

# Dependency manifests first, so the install layer is cached across source changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/protocol/package.json packages/protocol/
COPY packages/fake-node/package.json packages/fake-node/
RUN pnpm install --frozen-lockfile

COPY . .
# The server bundle contains every JavaScript dependency; only better-sqlite3 (native)
# ships beside it, trimmed to this architecture's musl prebuild (N-API, any Node version).
RUN pnpm --filter @meshterm/web build \
 && pnpm --filter @meshterm/server build \
 && mkdir -p /out/node_modules \
 && cp -rL apps/server/node_modules/better-sqlite3 /out/node_modules/better-sqlite3 \
 && cd /out/node_modules/better-sqlite3 \
 && rm -rf deps src docs build/Release/obj* build/Release/.deps build/deps \
 && find prebuilds -type f ! -name "linuxmusl-$(node -p process.arch).node" -delete \
 && node -e "const D=require('/out/node_modules/better-sqlite3'); new D(':memory:').close()"

# ── FakeNode: test double for compose.test.yml (never needed in production) ───
FROM build AS fake-node
WORKDIR /app/packages/fake-node
EXPOSE 4403 4404
ENTRYPOINT ["pnpm", "exec", "tsx", "src/cli.ts"]
CMD ["serve", "--host", "0.0.0.0", "--control-host", "0.0.0.0"]

# ── Runtime ─────────────────────────────────────────────────────────────────────
FROM node:26-alpine AS runtime
# The app needs only the `node` binary: drop package managers, headers and docs.
RUN rm -rf /usr/local/lib/node_modules /usr/local/bin/npm /usr/local/bin/npx \
           /usr/local/bin/corepack /opt/yarn* /usr/local/bin/yarn /usr/local/bin/yarnpkg \
           /usr/local/include /usr/local/share/doc /usr/local/share/man \
 && mkdir -p /data && chown 1000:1000 /data
WORKDIR /app
# Same layout as the repo, which the server relies on to find web/dist, drizzle/ and themes/.
COPY --from=build /out/node_modules apps/server/node_modules
COPY --from=build /app/apps/server/dist/main.js apps/server/dist/main.js
COPY --from=build /app/apps/server/drizzle apps/server/drizzle
COPY --from=build /app/apps/web/dist apps/web/dist
COPY --from=build /app/themes themes

ENV NODE_ENV=production \
    MESHTERM_DATA_DIR=/data \
    MESHTERM_HTTP_PORT=8080
# The base image's `node` user is 1000:1000.
USER 1000:1000
VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
CMD ["node", "apps/server/dist/main.js"]

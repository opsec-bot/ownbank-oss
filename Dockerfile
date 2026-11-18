# ownbank image: one process, SQLite on a volume at /data, optionally streamed to object storage by Litestream.

FROM node:22-bookworm-slim AS build
WORKDIR /app
# Build tools only in case better-sqlite3 has no prebuilt binary for this Node.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npx next build

FROM node:22-bookworm-slim
WORKDIR /app
ARG LITESTREAM_VERSION=0.3.13
# Set by buildx/BuildKit (amd64 or arm64), so the same Dockerfile builds on a PC, a Raspberry Pi or Apple Silicon.
ARG TARGETARCH=amd64
ADD https://github.com/benbjohnson/litestream/releases/download/v${LITESTREAM_VERSION}/litestream-v${LITESTREAM_VERSION}-linux-${TARGETARCH}.deb /tmp/litestream.deb
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && dpkg -i /tmp/litestream.deb \
  && rm -rf /tmp/litestream.deb /var/lib/apt/lists/*
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 DATABASE_PATH=/data/ownbank.db PORT=8080 HOSTNAME=0.0.0.0
# Next standalone server, static assets, public files, migrations (run on server start), and the owner script.
COPY --from=build /app/.next/standalone /app
COPY --from=build /app/.next/static /app/.next/static
COPY --from=build /app/public /app/public
COPY --from=build /app/src/lib/db/migrations /app/src/lib/db/migrations
# create-owner and doctor run inside the container (docker compose exec / fly ssh console): they need tsx, the full node_modules and the scripts.
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/package.json /app/tsconfig.json /app/
COPY --from=build /app/scripts /app/scripts
COPY --from=build /app/src /app/src
COPY deploy/litestream.yml /etc/litestream.yml
COPY deploy/start.sh /app/deploy/start.sh
RUN chmod +x /app/deploy/start.sh
EXPOSE 8080
CMD ["/app/deploy/start.sh"]

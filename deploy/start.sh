#!/bin/sh
# Starts the app under Litestream so every database write is streamed to the bucket.
# On a fresh volume the database is restored from the bucket first. Migrations run when the server starts.
set -e
START="node /app/server.js"
mkdir -p /data
# One-time import: if /data/import.db was uploaded (fly ssh sftp), it replaces the database on this boot,
# before Litestream starts, so backups begin a fresh generation from the imported copy.
if [ -f /data/import.db ]; then
  echo "Importing /data/import.db" >&2
  rm -rf /data/ownbank.db /data/ownbank.db-wal /data/ownbank.db-shm /data/.ownbank.db-litestream
  mv /data/import.db /data/ownbank.db
fi
if [ -n "$BUCKET_NAME" ]; then
  litestream restore -if-db-not-exists -if-replica-exists /data/ownbank.db
  exec litestream replicate -exec "$START"
fi
echo "BUCKET_NAME not set: running without backups" >&2
exec $START

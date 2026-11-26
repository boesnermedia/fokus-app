#!/bin/sh
set -e
DATA=/pb/pb_data
mkdir -p "$DATA"

# Admin-Zugang (PocketBase-Oberfläche unter /_/) mit denselben Zugangsdaten wie die App.
if [ -n "$FOKUS_EMAIL" ] && [ -n "$FOKUS_PASSWORD" ]; then
  /pb/pocketbase superuser upsert "$FOKUS_EMAIL" "$FOKUS_PASSWORD" \
    --dir="$DATA" --migrationsDir=/pb/pb_migrations || true
fi

exec /pb/pocketbase serve --http=0.0.0.0:8090 \
  --dir="$DATA" \
  --migrationsDir=/pb/pb_migrations \
  --hooksDir=/pb/pb_hooks \
  --publicDir=/pb/pb_public

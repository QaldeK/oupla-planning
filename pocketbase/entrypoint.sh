#!/bin/sh
set -e

# Upsert du superuser depuis les env Dokploy si définies — chemin de
# récupération du compte admin sans passer par SQLite sur le VPS.
# Sinon: le superuser déjà persisté dans pb_data suffit.
if [ -n "$PB_ADMIN_EMAIL" ] && [ -n "$PB_ADMIN_PASSWORD" ]; then
	/usr/local/bin/pocketbase superuser upsert "$PB_ADMIN_EMAIL" "$PB_ADMIN_PASSWORD" --dir=/pb_data
fi

exec "$@"

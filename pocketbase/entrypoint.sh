#!/bin/sh
set -e

# Upsert du superuser depuis les env Dokploy si définies — chemin de
# récupération du compte admin sans passer par SQLite sur le VPS.
# Sinon: le superuser déjà persisté dans pb_data suffit.
if [ -n "$PB_ADMIN_EMAIL" ] && [ -n "$PB_ADMIN_PASSWORD" ]; then
	/usr/local/bin/pocketbase superuser upsert "$PB_ADMIN_EMAIL" "$PB_ADMIN_PASSWORD" --dir=/pb_data
fi

# Le schéma voyage dans l'image, les données dans le volume : appliquer les
# migrations avant de servir garantit que le second rattrape la première.
# `serve` garde --automigrate=false ; cette étape est explicite et son échec
# bloque le démarrage au lieu de laisser le code tourner sur un schéma en
# retard. Les commandes `migrate` explicites ne sont pas précédées : elles
# feraient double emploi.
if [ "$1" = "pocketbase" ] && [ "$2" = "serve" ]; then
	/usr/local/bin/pocketbase migrate up --dir=/pb_data --migrationsDir=/pb_migrations --hooksDir=/pb_hooks
fi

exec "$@"

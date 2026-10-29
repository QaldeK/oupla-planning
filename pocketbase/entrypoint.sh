#!/bin/sh
set -e

# Upsert du superuser depuis les env Dokploy si définies — chemin de
# récupération du compte admin sans passer par SQLite sur le VPS.
# Sinon: le superuser déjà persisté dans pb_data suffit.
if [ -n "$PB_ADMIN_EMAIL" ] && [ -n "$PB_ADMIN_PASSWORD" ]; then
	/usr/local/bin/pocketbase superuser upsert "$PB_ADMIN_EMAIL" "$PB_ADMIN_PASSWORD" --dir=/pb_data
fi

# Redondance assumée : `serve` applique de toute façon les migrations du
# dépôt au bootstrap — --automigrate=false ne coupe que la génération de
# fichiers de migration sur changement de schéma via console/API. Cette étape
# explicite trace l'application dans les logs de boot et fait échouer le
# démarrage avant le healthcheck si une migration casse. Les commandes
# `migrate` explicites ne sont pas précédées : elles feraient double emploi.
if [ "$1" = "pocketbase" ] && [ "$2" = "serve" ]; then
	/usr/local/bin/pocketbase migrate up --dir=/pb_data --migrationsDir=/pb_migrations --hooksDir=/pb_hooks
fi

exec "$@"

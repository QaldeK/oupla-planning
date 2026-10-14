#!/usr/bin/env bash
# Instance PocketBase jetable pour les tests d'intégration.
#
# Pourquoi : l'instance de dev (pb_data/, port 8090) porte la config SMTP
# réelle. Si ce SMTP est injoignable depuis la machine, l'envoi mail synchrone
# du hook contact bloque la requête plusieurs minutes et les tests de
# soumission valide explosent en timeout. Cette instance tourne sur un dossier
# de données séparé où le SMTP est désactivé : l'envoi y échoue instantanément
# (comportement attendu par les tests en local), sans toucher à pb_data/.
#
# Usage :
#   ./dev-test-server.sh start    # provisionne (1er lancement) puis démarre
#   ./dev-test-server.sh stop
#   ./dev-test-server.sh status
#
# Port 8091 (l'instance de dev reste sur 8090). Les données vivent dans /tmp :
# jetables, mais réutilisées entre les runs pour éviter le replay des
# migrations (~45 s à chaque premier démarrage).
set -euo pipefail

PORT=8091
URL="http://127.0.0.1:${PORT}"
DATA_DIR="${TMPDIR:-/tmp}/opencode/oupla-pb-test"
LOG_FILE="${DATA_DIR}.log"
PID_FILE="${DATA_DIR}.pid"
# Identifiants attendus par tests/integration/globalSetup.ts
ADMIN_EMAIL="test@example.com"
ADMIN_PASSWORD="testpassword"

cd "$(dirname "$0")"

is_up() { curl -sf -m 2 "${URL}/api/health" >/dev/null 2>&1; }

wait_up() {
	local deadline=$((SECONDS + 120))
	until is_up; do
		if ((SECONDS >= deadline)); then
			echo "Timeout : instance non joignable sur ${URL} (voir ${LOG_FILE})" >&2
			exit 1
		fi
		sleep 1
	done
}

start() {
	if is_up; then
		echo "Déjà démarrée : ${URL}"
		exit 0
	fi
	mkdir -p "$DATA_DIR"
	./pocketbase superuser upsert "$ADMIN_EMAIL" "$ADMIN_PASSWORD" --dir="$DATA_DIR"
	nohup ./pocketbase serve \
		--http="127.0.0.1:${PORT}" \
		--dir="$DATA_DIR" \
		--hooksDir=./pb_hooks \
		--migrationsDir=./pb_migrations \
		>"$LOG_FILE" 2>&1 &
	echo $! >"$PID_FILE"
	wait_up
	echo "Instance prête : ${URL}"
	echo "  données : ${DATA_DIR} (SMTP désactivé)"
	echo "  logs    : ${LOG_FILE}"
	echo "Lancer les tests depuis la racine du repo :"
	echo "  VITE_PLANNING_PB_URL=${URL} bun run test:integration"
}

stop() {
	if [[ ! -f "$PID_FILE" ]]; then
		echo "Aucun PID enregistré — l'instance n'a pas été démarrée par ce script." >&2
		exit 1
	fi
	local pid
	pid=$(cat "$PID_FILE")
	# Garde-fou : ne jamais tuer un PID recyclé par un autre process.
	if ps -p "$pid" -o args= 2>/dev/null | grep -q "pocketbase serve"; then
		kill "$pid"
		echo "Arrêtée (pid ${pid})."
	else
		echo "Process ${pid} introuvable ou non-PocketBase — nettoyage du PID file."
	fi
	rm -f "$PID_FILE"
}

status() {
	if is_up; then
		echo "UP   ${URL}"
	else
		echo "DOWN ${URL}"
	fi
}

case "${1:-}" in
start) start ;;
stop) stop ;;
status) status ;;
*)
	echo "Usage : $0 {start|stop|status}" >&2
	exit 1
	;;
esac

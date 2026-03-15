FROM oven/bun:1.3.10

WORKDIR /app

# Copier les fichiers de dépendances
COPY package.json bun.lock* ./

# Installer les dépendances
RUN bun install --frozen-lockfile --production

# Copier le code source
COPY src/ ./src/

# 🔍 DEBUG: Vérifier que les fichiers sont bien copiés
RUN ls -la /app && \
    ls -la /app/src && \
    echo "=== Contenu de /app/src/notify.ts (premières lignes) ===" && \
    head -20 /app/src/notify.ts

# Exposer le port
EXPOSE 3001

# Commande de démarrage - exécution directe du fichier TypeScript
CMD ["sh", "-c", "echo '=== Démarrage du conteneur ===' && ls -la /app/src && bun src/notify.ts"]

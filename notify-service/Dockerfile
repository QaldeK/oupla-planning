FROM oven/bun:1

WORKDIR /app

# Copier les fichiers de dépendances
COPY package.json bun.lock* ./

# Installer les dépendances
RUN bun install --frozen-lockfile --production

# Copier le code source
COPY src/ ./src/

# Exposer le port
EXPOSE 3001

# Commande de démarrage
CMD ["bun", "run", "start"]

# Image PocketBase de oupla-planning.
#
# Contient le binaire officiel épinglé + les hooks et migrations du repo.
# Les données (pb_data) restent dans un volume Docker — jamais dans l'image.
# Base choisie : binaire officiel directement, pas d'image tierce (leçon
# muchobien : repo disparu, comportement opaque, dérive :latest).
#
# Montée de version PocketBase (une seule ligne à changer) :
#   1. bump PB_VERSION
#   2. aligner le binaire local puis `bun run test:integration`
#   3. vérifier le changelog PB côté hooks/JSVM (discipline source-first)
#   4. redéployer Dokploy
ARG PB_VERSION=0.39.11
FROM alpine:3.20
ARG PB_VERSION
ARG TARGETARCH

RUN apk add --no-cache unzip ca-certificates tzdata

ADD https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_${TARGETARCH}.zip /tmp/pb.zip
RUN unzip -j /tmp/pb.zip pocketbase -d /usr/local/bin/ \
	&& chmod +x /usr/local/bin/pocketbase \
	&& rm /tmp/pb.zip \
	&& mkdir -p /pb_data /pb_public

# --chmod=755 : l'exécutabilité ne dépend pas du mode du fichier dans le
# contexte de build (un bit +x perdu en route = crashloop ENTRYPOINT au deploy).
COPY --chmod=755 entrypoint.sh /usr/local/bin/entrypoint.sh
COPY pb_hooks/ /pb_hooks/
COPY pb_migrations/ /pb_migrations/

# automigrate=false : toute évolution de schéma passe par les migrations du
# repo, jamais par la console admin (sinon dérive prod/git, cf. le fantôme
# 1785452446). hooksWatch=false : les hooks sont immuables dans l'image, le
# hot-reload est un confort de dev.
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["pocketbase", "serve", "--http=0.0.0.0:8090", "--dir=/pb_data", "--publicDir=/pb_public", "--hooksDir=/pb_hooks", "--migrationsDir=/pb_migrations", "--automigrate=false", "--hooksWatch=false"]

EXPOSE 8090

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
	CMD wget -qO- http://127.0.0.1:8090/api/health || exit 1

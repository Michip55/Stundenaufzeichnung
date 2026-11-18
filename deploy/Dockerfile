# syntax=docker/dockerfile:1
# BauTag – Container für den Echtbetrieb (API.md 12.1)
# Bauen aus dem Repository-Hauptordner:  docker build -f deploy/Dockerfile -t bautag .
FROM node:22-slim

ENV NODE_ENV=production \
    BAUTAG_TEST= \
    PORT=3000 \
    TRUST_PROXY=1 \
    BAUTAG_DB=/daten/bautag.db \
    BAUTAG_UPLOADS=/daten/uploads \
    NODE_OPTIONS=--disable-warning=ExperimentalWarning

WORKDIR /bautag/app
COPY app/package.json app/package-lock.json ./
# Optional: eigene Zertifizierungsstelle (Firmen-Proxy) als Build-Secret „ca“ – im Normalfall leer
RUN --mount=type=secret,id=ca,required=false \
    if [ -s /run/secrets/ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/ca; fi; \
    npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY app/server ./server
COPY app/public ./public
# Excel-Firmenvorlage (Abgleich beim Katalog-Import)
COPY docs/vorlage /bautag/docs/vorlage

# Daten und Sicherungen liegen in Volumes; die App läuft nie als root
RUN mkdir -p /daten /sicherung && chown -R node:node /daten /sicherung
USER node

# N-030: Programmstand, aus dem das Image gebaut wurde (update.sh vergleicht ihn mit dem Repository)
ARG BAUTAG_REVISION=unbekannt
LABEL org.opencontainers.image.revision=$BAUTAG_REVISION

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/gesundheit').then(r=>r.json()).then(j=>process.exit(j.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.js"]

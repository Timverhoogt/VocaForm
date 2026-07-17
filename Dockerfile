FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    fonts-dejavu-core \
    libreoffice-writer \
    tini \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci
RUN PLAYWRIGHT_BROWSERS_PATH=/ms-playwright npx playwright install --with-deps chromium \
  && chmod -R a+rX /ms-playwright

COPY . .
RUN npm run build \
  && mkdir -p /tmp/vocaform \
  && chown node:node /tmp/vocaform

ENV NODE_ENV=production \
  PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
  HOST=0.0.0.0 \
  PORT=10000 \
  SOFFICE_BIN=/usr/bin/soffice \
  VOCAFORM_STORAGE_MODE=ephemeral \
  VOCAFORM_WORK_DIR=/tmp/vocaform

USER node

EXPOSE 10000

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["npm", "start"]

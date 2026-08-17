FROM node:22-alpine AS deps
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-alpine AS assets
WORKDIR /app
COPY scripts/build.js ./scripts/build.js
COPY css/ ./css/
COPY js/ ./js/
COPY shared/ ./shared/
RUN node scripts/build.js

FROM node:22-alpine AS runtime
WORKDIR /app
RUN apk add --no-cache wget
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=assets /app/assets ./assets
COPY --from=assets /app/asset-manifest.json ./asset-manifest.json
COPY package.json ./
COPY server/ ./server/
COPY scripts/ ./scripts/
COPY index.html ./
COPY manifest.webmanifest ./
COPY css/ ./css/
COPY js/ ./js/
COPY shared/ ./shared/
COPY fonts/ ./fonts/

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1

CMD ["node", "server/index.js"]

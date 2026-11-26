FROM node:24-bookworm-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY vite.config.js ./
COPY web ./web
COPY public ./public
RUN npm run build

FROM node:24-bookworm-slim
ENV NODE_ENV=production DATA_DIR=/data HOST=0.0.0.0 PORT=3000
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src
COPY web/src/lib/dehyphenate.js web/src/lib/dehyphenate-dict.js ./web/src/lib/
COPY web/src/lib/dehyphenate-dict ./web/src/lib/dehyphenate-dict
COPY --from=builder /app/dist ./dist
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 3000
VOLUME ["/data"]
CMD ["node", "src/server.js"]

FROM node:22-bookworm-slim AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production \
    DATA_DIR=/data \
    WEB_PORT=3847 \
    DEVICE_PORT=5923
LABEL org.opencontainers.image.title="box_io-docker-server" \
      org.opencontainers.image.description="Box IO self-hosted IoT server for Arduino and ESP32" \
      org.opencontainers.image.source="https://github.com/Someone275/Box_IO-Docker-server" \
      org.opencontainers.image.url="https://github.com/Someone275/Box_IO-Docker-server"
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY tsconfig.json ./
COPY --from=web /web/dist ./web/dist
RUN mkdir -p /data
EXPOSE 3847 5923
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.WEB_PORT||3847)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npx", "tsx", "src/index.ts"]

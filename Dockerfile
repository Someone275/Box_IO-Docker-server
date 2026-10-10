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
COPY keep-up.sh /keep-up.sh
COPY --from=web /web/dist ./web/dist
RUN chmod +x /keep-up.sh && mkdir -p /data
EXPOSE 3847 5923
VOLUME ["/data"]
# The file is touched every second by the program. A second Node process
# for this check was enough to stall a small server.
HEALTHCHECK --interval=15s --timeout=3s --start-period=40s --retries=3 \
  CMD sh -c 'test -f /data/alive && test $(( $(date +%s) - $(stat -c %Y /data/alive) )) -lt 20'
CMD ["/bin/sh", "/keep-up.sh"]

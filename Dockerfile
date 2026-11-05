# syntax=docker/dockerfile:1
# WebUI image: one self-contained server bundle + static web UI.
FROM node:22-slim AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /app
COPY . .
# desktop shell is not needed for the WebUI image; skip Electron's binary download
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
RUN pnpm install --frozen-lockfile --filter @hzc/core --filter @hzc/server --filter @hzc/web \
 && pnpm --filter @hzc/core build \
 && pnpm --filter @hzc/web build \
 && pnpm --filter @hzc/server build

FROM node:22-slim
WORKDIR /app
RUN useradd -m -u 10001 hzc && mkdir -p /data && chown hzc /data
COPY --from=build /app/apps/server/dist ./server
COPY --from=build /app/apps/web/dist ./web
ENV HZC_DATA_DIR=/data HZC_WEB_DIR=/app/web HZC_HOST=0.0.0.0 PORT=8787 NODE_ENV=production
# FFmpeg powers video prompt reverse and export (Debian build; see licence audit)
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
USER hzc
VOLUME /data
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# The server refuses to bind a non-loopback address unless HZC_TOKEN is set.
CMD ["node", "server/index.mjs"]

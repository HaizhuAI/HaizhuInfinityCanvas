# syntax=docker/dockerfile:1
# WebUI image: one self-contained server bundle + static web UI.
# the build output is plain JavaScript: build once on the runner's own platform, for every target platform
FROM --platform=$BUILDPLATFORM node:22-slim AS build
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
LABEL org.opencontainers.image.title="Haizhu Infinity Canvas" \
      org.opencontainers.image.description="Infinite node canvas for image and video creators (WebUI)" \
      org.opencontainers.image.source="https://github.com/HaizhuAI/HaizhuInfinityCanvas"
WORKDIR /app
RUN useradd -m -u 10001 hzc && mkdir -p /data && chown hzc /data
COPY --from=build /app/apps/server/dist ./server
COPY --from=build /app/apps/web/dist ./web
COPY --from=build /app/THIRD_PARTY_NOTICES.md ./THIRD_PARTY_NOTICES.md
ENV HZC_DATA_DIR=/data HZC_WEB_DIR=/app/web HZC_HOST=0.0.0.0 PORT=8787 NODE_ENV=production
# FFmpeg powers video prompt reverse and export (Debian build; see licence audit)
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
USER hzc
VOLUME /data
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# The server refuses to bind a non-loopback address unless HZC_TOKEN is set (one workspace) or
# HZC_ACCOUNTS=1 with HZC_ALLOWED_HOSTS (sign-up accounts, one private workspace each).
CMD ["node", "server/index.mjs"]

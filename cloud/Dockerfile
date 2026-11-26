FROM oven/bun:1.4.4-debian

USER root
RUN apt-get update \
    && apt-get install -y --no-install-recommends tini \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --chown=bun:bun . .
RUN install -d -o bun -g bun -m 0700 /var/lib/postline \
    && chown bun:bun /app \
    && install -d -o bun -g bun content \
    && ln -s /var/lib/postline/blog content/blog

USER bun
RUN bun install --production --frozen-lockfile

ENV APP_ENV=production NODE_ENV=production APP_URL=http://localhost:3000 \
    PORT=3000 PORT_API=3008 DB_CONNECTION=sqlite DB_DATABASE_PATH=/var/lib/postline/postline.sqlite \
    POSTLINE_MEDIA_DIR=/var/lib/postline/media

EXPOSE 3000
VOLUME ["/var/lib/postline"]
HEALTHCHECK --start-period=60s --interval=15s --timeout=5s \
  CMD ["bun", "-e", "const health = await fetch(`http://127.0.0.1:${process.env.PORT}/api/postline/health`); process.exit(health.ok && (await health.json()).ok ? 0 : 1)"]
ENTRYPOINT ["/usr/bin/tini", "--", "bun", "scripts/serve-container.ts"]

# syntax=docker/dockerfile:1
FROM oven/bun:1.3.9 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN --mount=type=cache,target=/root/.bun/install/cache bun install --frozen-lockfile
COPY . .
RUN bun run build && bun run build:server

FROM oven/bun:1.3.9-slim AS runtime
WORKDIR /app
LABEL org.opencontainers.image.title="Sub2api Manager" \
      org.opencontainers.image.description="Mobile-first sub2api monitoring PWA"
COPY --from=build /app/dist ./dist
COPY --from=build /app/build/server.js ./server.js
COPY scripts/healthcheck.ts ./healthcheck.ts
RUN mkdir /app/data && chown bun:bun /app/data
USER bun
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3001 DATA_DIR=/app/data
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["bun", "/app/healthcheck.ts"]
CMD ["bun", "/app/server.js"]

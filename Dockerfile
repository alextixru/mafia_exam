# syntax=docker/dockerfile:1.7

# ─── 1. сборка фронта ─────────────────────────────────────────────────────────
FROM oven/bun:1.3 AS web
WORKDIR /app

# shared-схема нужна и фронту, и боту, копируем её сюда (vite-alias @shared)
COPY src/shared ./src/shared

COPY admin/package.json admin/bun.lock ./admin/
RUN cd admin && bun install --frozen-lockfile

COPY admin ./admin
RUN cd admin && bun run build

# ─── 2. зависимости бота ──────────────────────────────────────────────────────
FROM oven/bun:1.3 AS bot-deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# ─── 3. рантайм ───────────────────────────────────────────────────────────────
FROM oven/bun:1.3 AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    HTTP_PORT=3000 \
    POLLS_DIR=/data/polls \
    DATA_DIR=/data/state \
    STATIC_DIR=/app/admin/dist

# исходники бота и shared
COPY --from=bot-deps /app/node_modules ./node_modules
COPY package.json bun.lock ./
COPY src ./src
COPY tsconfig.json ./

# собранный фронт
COPY --from=web /app/admin/dist ./admin/dist

# дефолтные опросы (если volume пустой при первом запуске —
# можно потом удалить или заменить через админку)
COPY polls ./polls.default

# entrypoint: при первом старте, если /data пуст, заполняем дефолтами
COPY <<'EOF' /app/entrypoint.sh
#!/bin/sh
set -e
mkdir -p "$POLLS_DIR" "$DATA_DIR"
if [ -z "$(ls -A "$POLLS_DIR" 2>/dev/null)" ] && [ -d /app/polls.default ]; then
  echo "Seeding $POLLS_DIR with defaults…"
  cp -r /app/polls.default/. "$POLLS_DIR"/
fi
exec bun run src/index.ts
EOF
RUN chmod +x /app/entrypoint.sh

EXPOSE 3000
CMD ["/app/entrypoint.sh"]

# ─── 1. Сборка фронта (Vite + React + Tailwind) ───────────────────────────────
FROM oven/bun:1.3 AS web
WORKDIR /app

# shared poll-schema нужна фронту через vite-alias @shared/*
COPY src/shared ./src/shared

COPY admin/package.json admin/bun.lock ./admin/
RUN cd admin && bun install --frozen-lockfile

COPY admin ./admin
RUN cd admin && bun run build


# ─── 2. Зависимости бота (production-only) ────────────────────────────────────
FROM oven/bun:1.3 AS bot-deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production


# ─── 3. Рантайм ───────────────────────────────────────────────────────────────
FROM oven/bun:1.3 AS runtime
WORKDIR /app

# Пути по умолчанию. Dokploy может перекрыть через UI.
ENV NODE_ENV=production \
    HTTP_PORT=3000 \
    POLLS_DIR=/data/polls \
    DATA_DIR=/data/state \
    STATIC_DIR=/app/admin/dist

# зависимости + исходники бота
COPY --from=bot-deps /app/node_modules ./node_modules
COPY package.json bun.lock tsconfig.json ./
COPY src ./src

# собранный фронт
COPY --from=web /app/admin/dist ./admin/dist

# дефолтные опросы — заливаются на volume только при первом старте
COPY polls ./polls.default

# entrypoint
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

EXPOSE 3000
CMD ["/app/entrypoint.sh"]

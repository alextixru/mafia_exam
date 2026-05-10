#!/bin/sh
set -e

cd /app

mkdir -p "$POLLS_DIR" "$DATA_DIR"

# Если volume пустой при первом старте — заполняем дефолтами,
# чтобы у бота были тестовые опросы для главного меню.
if [ -z "$(ls -A "$POLLS_DIR" 2>/dev/null)" ] && [ -d /app/polls.default ]; then
  echo "Seeding $POLLS_DIR with defaults…"
  cp -r /app/polls.default/. "$POLLS_DIR"/
fi

exec bun run src/index.ts

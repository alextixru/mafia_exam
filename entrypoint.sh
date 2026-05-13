#!/bin/sh
set -e

cd /app

mkdir -p "$POLLS_DIR" "$DATA_DIR"

# Если volume пустой при первом старте — заполняем дефолтами,
# чтобы у бота были тестовые опросы для главного меню.
# Переименовываем файлы по полю "id" внутри JSON, чтобы имя файла
# совпадало с id опроса — иначе при первом save из админки появится
# второй файл с тем же id и бот упадёт на дубликате при рестарте.
if [ -z "$(ls -A "$POLLS_DIR" 2>/dev/null)" ] && [ -d /app/polls.default ]; then
  echo "Seeding $POLLS_DIR with defaults…"
  for src in /app/polls.default/*.json; do
    [ -f "$src" ] || continue
    id=$(bun -e "console.log(JSON.parse(require('fs').readFileSync('$src','utf8')).id)" 2>/dev/null || true)
    if [ -n "$id" ]; then
      cp "$src" "$POLLS_DIR/$id.json"
    else
      # fallback: положили как есть, если по какой-то причине не удалось вытащить id
      cp "$src" "$POLLS_DIR/"
    fi
  done
fi

exec bun run src/index.ts

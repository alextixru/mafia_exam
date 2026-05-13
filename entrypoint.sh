#!/bin/sh
# Без -e: хочу прорабатывать каждую строку и логировать что произошло.

echo "[entrypoint] starting"
echo "[entrypoint] pwd=$(pwd)"
echo "[entrypoint] POLLS_DIR=$POLLS_DIR"
echo "[entrypoint] DATA_DIR=$DATA_DIR"
echo "[entrypoint] STATIC_DIR=$STATIC_DIR"

cd /app || {
  echo "[entrypoint] ERROR: cannot cd /app"
  exit 1
}

mkdir -p "$POLLS_DIR" "$DATA_DIR"
if [ $? -ne 0 ]; then
  echo "[entrypoint] ERROR: mkdir failed for $POLLS_DIR / $DATA_DIR"
  echo "[entrypoint] ls -la /data:"
  ls -la /data 2>&1
  exit 1
fi
echo "[entrypoint] data dirs ok"

# Сидинг дефолтов — только если папка опросов пустая.
if [ -z "$(ls -A "$POLLS_DIR" 2>/dev/null)" ] && [ -d /app/polls.default ]; then
  echo "[entrypoint] seeding $POLLS_DIR from /app/polls.default…"
  for src in /app/polls.default/*.json; do
    [ -f "$src" ] || continue
    id=$(bun -e "console.log(JSON.parse(require('fs').readFileSync('$src','utf8')).id)" 2>/dev/null)
    if [ -n "$id" ]; then
      cp "$src" "$POLLS_DIR/$id.json"
      echo "[entrypoint]   seeded $id"
    else
      cp "$src" "$POLLS_DIR/"
      echo "[entrypoint]   seeded (no id extracted) $(basename "$src")"
    fi
  done
else
  echo "[entrypoint] $POLLS_DIR is not empty or no defaults — skip seeding"
fi

echo "[entrypoint] launching bot…"
exec bun run src/index.ts

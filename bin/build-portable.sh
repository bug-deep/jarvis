#!/bin/bash
# Собирает портативную Windows-версию: node.exe + исходники + Jarvis.bat.
# Запуск: CLOUD_URL=http://... PORT=8095 bin/build-portable.sh
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
STAGE="$ROOT/dist/portable"
CACHE="$ROOT/data/cache"
NODE_VERSION="${NODE_VERSION:-v22.23.4}"
CLOUD_URL="${CLOUD_URL:-https://jarvis.example.com}"
PORT="${PORT:-8095}"

rm -rf "$STAGE"
mkdir -p "$STAGE/app/src" "$STAGE/node" "$CACHE"

ZIP="$CACHE/node-$NODE_VERSION-win-x64.zip"
if [ ! -f "$ZIP" ]; then
  curl -fL --retry 3 -o "$ZIP" "https://nodejs.org/dist/$NODE_VERSION/node-$NODE_VERSION-win-x64.zip"
fi

python3 - "$ZIP" "$STAGE/node/node.exe" <<'PY'
import sys
import zipfile

zip_path, out = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(zip_path) as archive:
    name = next(item for item in archive.namelist() if item.endswith('/node.exe'))
    with open(out, 'wb') as handle:
        handle.write(archive.read(name))
PY

cp -r "$ROOT/src/app" "$ROOT/src/shared" "$STAGE/app/src/"
cp "$ROOT/src/main.js" "$STAGE/app/src/main.js"
cp "$ROOT/config/jarvis-desktop.env.example" "$STAGE/app/.env.example"

VERSION=$(python3 -c "import json;print(json.load(open('$ROOT/package.json'))['version'])")

cat > "$STAGE/app/package.json" <<JSON
{
  "name": "jarvis-app",
  "version": "$VERSION",
  "private": true,
  "type": "module",
  "dependencies": {
    "@fastify/static": "^10.1.11",
    "fastify": "^5.12.8"
  }
}
JSON

printf '{\n  "cloudUrl": "%s",\n  "port": %s\n}\n' "$CLOUD_URL" "$PORT" > "$STAGE/app/jarvis.json"

(cd "$STAGE/app" && npm install --omit=dev --no-audit --no-fund >/dev/null)

cp "$ROOT/build/icon.ico" "$STAGE/icon.ico"

python3 - "$ROOT/bin/Jarvis.bat" "$STAGE/Jarvis.bat" "$ROOT/bin/README-portable.txt" "$STAGE/README.txt" <<'PY'
import sys

for source, target in [(sys.argv[1], sys.argv[2]), (sys.argv[3], sys.argv[4])]:
    data = open(source, 'rb').read().replace(b'\r\n', b'\n').replace(b'\n', b'\r\n')
    open(target, 'wb').write(data)
PY

python3 - "$STAGE" "$ROOT/dist/Jarvis-portable-win64.zip" <<'PY'
import pathlib
import sys
import zipfile

stage, out = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
if out.exists():
    out.unlink()
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
    for path in sorted(stage.rglob('*')):
        if path.is_file():
            archive.write(path, pathlib.Path('Jarvis') / path.relative_to(stage))
print(f"{out}: {out.stat().st_size / 1e6:.1f} МБ")
PY

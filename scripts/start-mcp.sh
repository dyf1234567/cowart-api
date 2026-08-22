#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$ROOT_DIR"

if [ ! -d node_modules ] \
  || [ ! -d node_modules/fractional-indexing ] \
  || [ ! -d node_modules/@modelcontextprotocol/ext-apps ] \
  || [ ! -d node_modules/@modelcontextprotocol/sdk ] \
  || [ ! -d node_modules/@tldraw/assets ] \
  || [ ! -d node_modules/zod ]; then
  npm install
fi

exec node ./mcp/server.mjs

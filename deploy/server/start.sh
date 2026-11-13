#!/bin/sh
# Haizhu Infinity Canvas · server package (WebUI on any Linux / macOS server). Needs Node.js 22.13+.
#   ./start.sh                 start (http://127.0.0.1:8787 by default)
#   ./start.sh admin users     operator commands in accounts mode
set -e
cd "$(dirname "$0")"
node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)' 2>/dev/null || {
  echo "需要 Node.js 22.13 或更高版本 / Node.js 22.13 or newer is required (found: $(node -v 2>/dev/null || echo none))" >&2
  exit 1
}
export HZC_WEB_DIR="${HZC_WEB_DIR:-$PWD/web}"
export HZC_DATA_DIR="${HZC_DATA_DIR:-$PWD/data}"
export NODE_ENV="${NODE_ENV:-production}"
exec node server/index.mjs "$@"

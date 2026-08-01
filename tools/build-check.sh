#!/usr/bin/env bash
# Render facts.json -> HTML -> PDF (headless Chrome) -> geometric diff vs original.
set -euo pipefail
cd "$(dirname "$0")/.."

ORIG="${1:-/home/vicky/repos/Vigneshwaran_AIEngineer.pdf}"
OUT="${JW_SCRATCH:-/tmp}"

node server/render.js data/facts.json data > "$OUT/preview.html"
timeout 90 google-chrome --headless=new --disable-gpu --no-sandbox \
  --no-pdf-header-footer --virtual-time-budget=10000 \
  --print-to-pdf="$OUT/rendered.pdf" "file://$OUT/preview.html" >/dev/null 2>&1
node tools/verify-render.js "$ORIG" "$OUT/rendered.pdf"

#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=== Deploy Worker ==="
cd "$SCRIPT_DIR/worker"
npm install
wrangler deploy

echo ""
echo "Worker deployed. Copy the worker URL shown above and set it as"
echo "NEXT_PUBLIC_API_URL in your Vercel project environment variables."
echo ""

echo "=== Deploy Frontend ==="
cd "$SCRIPT_DIR/frontend"
npm install
vercel --prod

echo ""
echo "Done."

#!/usr/bin/env bash
# One-command (re)deploy for the Email Verifier on a VPS.
# Run from the project root:  bash redeploy.sh
set -e
cd "$(dirname "$0")"

APP_NAME="email-verifier"

echo "==> [1/5] Pulling latest code (if this is a git checkout)"
git pull --ff-only 2>/dev/null || echo "    (not a git repo / nothing to pull — skipping)"

echo "==> [2/5] Installing backend dependencies"
npm install --omit=dev

echo "==> [3/5] Building the frontend"
( cd frontend && npm install && npm run build )

echo "==> [4/5] (Re)starting the backend under PM2"
if pm2 describe "$APP_NAME" >/dev/null 2>&1; then
  pm2 restart "$APP_NAME" --update-env
else
  pm2 start server.js --name "$APP_NAME" --node-args="--env-file=.env"
  pm2 save
fi

echo "==> [5/5] Reloading nginx"
nginx -t && systemctl reload nginx || echo "    (nginx not configured yet — see DEPLOYMENT.md)"

echo "==> Done. Backend health:"
sleep 1
curl -s http://127.0.0.1:3001/health || echo "    (backend not responding — check: pm2 logs $APP_NAME)"
echo

# Deploying the Email Verifier on a VPS

This guide deploys the Node.js API + React frontend on a single Ubuntu/Debian
VPS behind nginx, with the backend managed by PM2.

Architecture: **nginx** serves the built React app and reverse-proxies API
paths (`/auth`, `/verify`, `/health`) to the **Node backend** on `127.0.0.1:3001`.
Because everything is same-origin, no CORS headaches.

---

## ⚠️ 0. The most important prerequisite: outbound port 25

This app verifies mailboxes by connecting to the recipient's mail server on
**TCP port 25**. Almost every VPS provider (DigitalOcean, AWS, Google Cloud,
Vultr, Linode, Oracle, Azure…) **blocks outbound port 25 by default** to fight
spam. If it's blocked, every SMTP check times out and results come back
`unknown`.

Check from your VPS:

```bash
nc -zv -w 5 gmail-smtp-in.l.google.com 25   # or: timeout 5 bash -c '</dev/tcp/alt1.aspmx.l.google.com/25' && echo open
```

- **Open** → you're good.
- **Blocked/timeout** → open a support ticket asking to unblock outbound 25
  (some approve, some never do). Hetzner and OVH are usually the most lenient;
  AWS/GCP require a form and often refuse.

The Microsoft 365 check (`GetCredentialType`, over HTTPS/443) and syntax/MX/
disposable checks still work without port 25 — but true mailbox verification
needs it.

---

## 1. Server prep

```bash
sudo apt update && sudo apt upgrade -y
# Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs nginx git build-essential python3
# build-essential + python3 are needed to compile the sqlite3 native module
sudo npm install -g pm2
```

## 2. Get the code

```bash
# via git:
git clone <your-repo-url> ~/email-verifier
# or upload the zip and: unzip Custom-Email-Verifier-fixed.zip -d ~/email-verifier
cd ~/email-verifier
```

## 3. Backend

```bash
npm install --omit=dev
cp .env.example .env
nano .env     # set NODE_ENV=production, PORT=3001,
              # JWT_SECRET=<random>, CORS_ORIGINS=https://verifier.yourdomain.com

# generate a strong secret:
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

# start under PM2 and keep it alive on reboot. `node server.js` does NOT load
# .env by itself, so start it via Node's --env-file flag (Node 20+):
pm2 start server.js --name email-verifier --node-args="--env-file=.env"
pm2 save
pm2 startup     # run the command it prints

# (Alternative without PM2, for a quick test:)
#   node --env-file=.env server.js
```

Verify: `curl http://127.0.0.1:3001/health` → `{"status":"ok"}`

## 4. Frontend (build static assets)

The frontend must know where the API is. Behind the nginx proxy below it's
same-origin, so set the API base to empty:

```bash
cd frontend
npm install
echo 'VITE_API_URL=' > .env.production   # same-origin (proxied by nginx)
npm run build                             # outputs to frontend/dist
```

(If instead you serve the API on a separate domain, use
`VITE_API_URL=https://api.yourdomain.com` and keep `CORS_ORIGINS` in sync.)

## 5. nginx

```nginx
# /etc/nginx/sites-available/email-verifier
server {
    listen 80;
    server_name verifier.yourdomain.com;

    root /home/youruser/email-verifier/frontend/dist;
    index index.html;

    # React Router: serve index.html for any client-side route
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Proxy API paths to the Node backend
    location ~ ^/(auth|verify|health) {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        client_max_body_size 3m;   # allow CSV uploads (backend caps at 2 MB)
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/email-verifier /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

## 6. Firewall + HTTPS

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable

# Free TLS cert (also auto-renews):
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d verifier.yourdomain.com
```

After certbot, update `CORS_ORIGINS` / `VITE_API_URL` to the `https://` URL,
`pm2 restart email-verifier`, and rebuild the frontend if you changed its env.

---

## 7. Better SMTP verification results (optional but recommended)

Mailbox checks are more accurate and less likely to be blocked when your probe
identity looks legitimate:

- **Reverse DNS (PTR):** ask your VPS provider to set a PTR record for the
  server IP that matches a real hostname.
- **Probe domain:** edit `PROBE_DOMAIN` in `smtp.js` to a domain you own that
  has a valid SPF record (it's used in `EHLO`/`MAIL FROM`). The default
  `verify.example.com` works but a real domain gets fewer rejections.
- Verify gently — high volumes from one IP get greylisted or blocked.

## 8. Updating later

```bash
cd ~/email-verifier && git pull        # (or re-upload the zip)
npm install --omit=dev
pm2 restart email-verifier
cd frontend && npm install && npm run build
```

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| All results `unknown`, reason "Failed to connect to SMTP" | Outbound port 25 blocked (see §0). |
| `Mail server resolves to a non-public address (blocked)` | SSRF guard hit an internal MX; expected for internal domains — set `ALLOW_PRIVATE_MX=1` only if intentional. |
| Server won't start: "JWT_SECRET must be set" | Set `JWT_SECRET` in `.env` (required when `NODE_ENV=production`). |
| `sqlite3` install fails | Install `build-essential python3`, then `npm install` again. |
| Frontend loads but API calls fail (CORS/404) | Check nginx proxy paths and that `VITE_API_URL` matches your setup. |

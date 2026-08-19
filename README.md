# BounceCure — Custom Email Verifier

**Stop the bounce. Cure your list.** A full-featured SaaS email verifier: Node.js +
Express backend, React (Vite) frontend, Cloud Firestore data store, JWT auth with
optional Google sign-in and TOTP two-factor authentication, credit-based billing
(Stripe / Wise / bank transfer), and a role-based admin panel.

> **This README is the single guide for the project** — setup, configuration,
> accuracy, deployment, payments, admin, and security are all covered below.

---

## 1. Features

- **Email Verification** — single address, pasted list, or CSV/TXT upload with a
  column-mapping popup (pick the email column, header yes/no, remove duplicates).
- **Catch-All Verifier** — a dedicated tool that deep-resolves addresses on
  catch-all domains (the case ordinary verifiers mark "risky").
- **Bounce Rate** — free list analysis with two modes: *Fast estimate*
  (syntax + MX + disposable, near-instant) or *Accurate* (full SMTP mailbox check).
- **Buy Credits** — pricing-page-matched packs, paid by card (Stripe, instant,
  automatic crediting), Wise, or international bank transfer.
- **Tasks & Results** — 30-day execution history with full result export (CSV
  keeps every original column + the verdict columns).
- **Admin Panel** — user management with lifetime per-user history, permanent
  account IDs, credit top-ups, and role control (superadmin › admin › user).
- Security hardening throughout: rate limiting, atomic credits, SSRF-guarded
  SMTP, signature-verified + replay-proof Stripe webhook, 2FA-bypass fix.

## 2. Verification statuses

Every check returns one fine-grained status plus a 0–100 confidence score:

| Status | Meaning |
|---|---|
| `safe` | Real, deliverable mailbox (most likely personal). |
| `role` | Deliverable, but a role/group address (support@, info@, …). |
| `catch-all` | Domain accepts every address; the individual mailbox can't be confirmed. |
| `disposable` | Temporary / throwaway provider (mailinator etc.). |
| `invalid` | Mailbox doesn't exist / domain rejects mail — will bounce. |
| `inbox_full` | Mailbox exists but is over quota (may soft-bounce). |
| `disabled` | Account existed but was disabled/suspended by the provider. |
| `spamtrap` | Known spam-trap address — never send to it. |
| `unknown` | No definitive answer (greylisting, timeout, port 25 blocked). Never charged. |

**How it works:** syntax → disposable list → MX lookup → provider detection →
Microsoft 365 mailbox API (for M365 tenants) → SMTP `RCPT TO` handshake →
multi-probe catch-all detection → SMTP-reply parsing (over-quota / disabled /
spamtrap hints) → greylist retry. On catch-all domains, two extra signals can
still resolve the mailbox: the Microsoft 365 `GetCredentialType` API, and a
response-diff heuristic (the server phrasing its reply differently for the real
address than for random probes). Credits are charged **only for conclusive
results** — `unknown` (and `not_catch_all` on the Catch-All page) is free.

## 3. Quick start (local development)

**Prerequisites:** Node.js 20.12+ (`node -v`), npm, and a Firebase project —
**Cloud Firestore is the app's only data store and is required**.

### 3a. Firestore service account (required)

1. [Firebase console](https://console.firebase.google.com) → create a project →
   **Build → Firestore Database → Create database**.
2. **⚙️ Project settings → Service accounts → Generate new private key** — a
   JSON file downloads.
3. Save it as **`serviceAccount.json` in the project root** (next to
   `server.js`). It's auto-detected and git-ignored. (Alternatives: set
   `FIREBASE_SERVICE_ACCOUNT` to the JSON one-line, or
   `GOOGLE_APPLICATION_CREDENTIALS` to the file path.)

Nothing needs to be created inside the database — collections appear on first use.

### 3b. Backend (terminal 1)

```bash
npm install
cp .env.example .env        # then set at least JWT_SECRET
node server.js              # API on http://localhost:3001 (.env auto-loads)
```

Healthy startup log:

```
[Auth] Using ./serviceAccount.json
[Store] Active data store: FIRESTORE
[Diag] Outbound port 25 is OPEN ...        ← or a warning if blocked
Email Verifier API running on port 3001
```

`GET http://localhost:3001/health` → `{"status":"ok","store":"firestore","port25":true|false}`

### 3c. Frontend (terminal 2)

```bash
cd frontend
npm install
cp .env.example .env        # leave VITE_API_URL EMPTY for local dev
npm run dev                 # http://localhost:5173
```

Leave `VITE_API_URL` empty in dev — the Vite proxy forwards API calls to port
3001 (no CORS issues). Set it only for a cross-origin production API.

### 3d. First account & roles

- Register at `/register` — the **first account automatically becomes
  superadmin**. Do this immediately after deploying.
- Force roles via `.env` (applied at startup, even for existing accounts):
  `SUPERADMIN_EMAIL=you@company.com`, `ADMIN_EMAIL=teammate@company.com`.

| Viewer | Sees superadmins | Sees admins | Sees users |
|---|:-:|:-:|:-:|
| superadmin | ✅ | ✅ | ✅ |
| admin | ❌ | ✅ | ✅ |
| user | — no admin panel access | | |

Only a superadmin can grant/revoke superadmin or manage a superadmin; nobody can
change their own role or delete their own account; task deletion is
superadmin-only. All of this is enforced server-side.

## 4. Accuracy — the port 25 story

True mailbox verification talks SMTP on **outbound TCP port 25**, and almost
every cloud/VPS provider (AWS, GCP, Azure, DigitalOcean, …) **blocks it by
default**. When blocked, SMTP checks time out and results come back `unknown` —
only syntax/MX/disposable/M365 checks still produce verdicts. The server probes
port 25 at startup, warns loudly, and reports it at `/health` (`"port25"`).

To reach 90–95% accuracy:

1. **Host with port 25 open** (Hetzner/OVH are usually lenient; test with
   `nc -zv -w 5 gmail-smtp-in.l.google.com 25`).
2. **Use a real probe identity** in `.env` — this is the big one:
   ```
   VERIFY_HELO_DOMAIN=mail.yourdomain.com
   VERIFY_MAIL_FROM=verify@yourdomain.com
   ```
   Use a domain you own, with an **SPF record**, and ask your host to set the
   server IP's **reverse DNS (PTR)** to that hostname — mail servers weight a
   matching PTR heavily.
3. Keep `VERIFY_CONCURRENCY` moderate (default 10); lots of `unknown` from one
   provider means you're being rate-limited — lower it.

Alternative without port 25: route checks through a commercial API
(Reoon/ZeroBounce/NeverBounce) — pluggable on request.

## 5. Payments (Buy Credits)

Packs mirror the public pricing page (Free = the 100-credit signup bonus):
**Starter $19 → 10,000 credits**, **Pro $49 → 50,000 credits**.

- **Stripe (card, automatic):** set in `.env`:
  ```
  STRIPE_SECRET_KEY=sk_live_xxx
  STRIPE_WEBHOOK_SECRET=whsec_xxx
  FRONTEND_URL=https://app.yourdomain.com
  ```
  Create a webhook endpoint in the Stripe dashboard pointing to
  `https://yourdomain.com/billing/stripe/webhook` for the
  `checkout.session.completed` event. **A real (live-mode) paid checkout adds
  credits automatically.** Test-mode payments complete the flow but **never add
  credits**; duplicate/replayed webhook deliveries are rejected (signature +
  5-minute timestamp tolerance + per-event idempotency).
- **Wise:** set `WISE_PAYMENT_URL` and/or `WISE_EMAIL` — shown on the page. The
  buyer gets a payment reference (`BC-XXXXXXXX`); ops is notified by email
  (`BILLING_NOTIFY_EMAIL`), and an admin adds the credits after the transfer
  clears (Admin Panel → Add Credits).
- **International bank / SWIFT:** set any of `BANK_HOLDER`, `BANK_NAME`,
  `BANK_ACCOUNT`, `BANK_IBAN`, `BANK_SWIFT`, `BANK_NOTES` — same reference flow.

## 6. Optional integrations

### Google sign-in (Firebase Auth)
1. Firebase console → **Authentication → Sign-in method → Google → Enable**;
   keep `localhost` in Authorized domains (add your live domain later).
2. **Frontend** `frontend/.env`: `VITE_FIREBASE_API_KEY`,
   `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`,
   `VITE_FIREBASE_APP_ID` (from Project settings → Your apps → Web). Restart
   `npm run dev`.
3. **Backend** uses the same `serviceAccount.json` — nothing extra. Success log:
   `[Auth] Firebase Admin initialised — Google sign-in enabled.`

### Password-reset email (SMTP)
Without SMTP config the reset link is printed to the backend console (fine for
dev). To send real emails (Gmail example — use an **App Password**, not your
login password):

```
FRONTEND_URL=http://localhost:5173
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=you@gmail.com
SMTP_PASS=your16charapppassword
SMTP_FROM=BounceCure <you@gmail.com>
```

Any provider works (SendGrid/Mailgun/SES/…): port 465 = SSL, 587 = STARTTLS,
both handled automatically. Tokens are hashed, single-use, 1-hour TTL.

### Two-factor authentication (TOTP)
Built in, no setup: **My Account → Two-Factor Authentication → Enable Now** →
scan the QR with Google Authenticator/Authy → enter the 6-digit code. Login then
requires password + code. Disable from the same card with a current code.

## 7. Production deployment (VPS, copy-paste)

Single Ubuntu/Debian VPS; nginx forwards **everything** to Node (which also
serves the built frontend) — the simplest setup that never breaks on missing
proxy paths.

```bash
# 1. Server prep
sudo apt update && sudo apt upgrade -y
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs nginx git
sudo npm install -g pm2

# 2. Code
cd /root && git clone <your-repo-url> Custom-Email-Verifier   # or upload + unzip
cd Custom-Email-Verifier

# 3. Secrets
nano serviceAccount.json      # paste the Firebase service-account JSON
nano .env                     # see the block below
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"  # → JWT_SECRET

# 4. Backend deps + frontend build (backend serves frontend/dist itself)
npm install
cd frontend && echo "VITE_API_URL=" > .env.production && npm install && npm run build && cd ..

# 5. Run under PM2 (auto-restarts, survives reboot)
pm2 delete bouncecure 2>/dev/null
pm2 start server.js --name bouncecure
pm2 save && pm2 startup       # run the command it prints
pm2 logs bouncecure --lines 25
```

Minimum production `.env`:

```
NODE_ENV=production
PORT=3001
JWT_SECRET=YOUR_LONG_RANDOM_SECRET
FRONTEND_URL=https://verifier.yourdomain.com
VERIFY_HELO_DOMAIN=mail.yourdomain.com
VERIFY_MAIL_FROM=verify@yourdomain.com
# + SMTP_* for reset emails, STRIPE_*/WISE_*/BANK_* for payments (see §5, §6)
```

nginx (`/etc/nginx/sites-available/bouncecure`):

```nginx
server {
    listen 80;
    server_name verifier.yourdomain.com;
    client_max_body_size 20m;                 # large CSV uploads

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
    }
}
```

```bash
ln -sf /etc/nginx/sites-available/bouncecure /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

# Free HTTPS (recommended):
apt install -y certbot python3-certbot-nginx
certbot --nginx -d verifier.yourdomain.com
```

**Test:** open the domain, log in, verify an email, check Tasks & Results; and
`/health` should show `{"status":"ok","store":"firestore","port25":true}`.

**Updating later:**

```bash
cd /root/Custom-Email-Verifier
git pull origin main          # or upload the new zip
npm install
cd frontend && npm install && npm run build && cd ..
pm2 restart bouncecure
```

## 8. Admin Panel & lifetime history

- Every account gets a permanent display ID: **`BC-YYYYMMDD-NNNN`** (joining
  date + globally unique number), assigned at registration and backfilled for
  older accounts automatically.
- The users table shows **ID · Joined · Email · Role · Add Credits · Total
  Credits (balance + used) · Used Credits · Actions**. The Add Credits box adds
  a delta to the current balance (Enter or ✓).
- **Click any row** (outside the credit/actions controls) to open that user's
  lifetime history page: balance / used / total credits, lifetime verifications
  and executions, and their stored runs — with a Back button.
- Lifetime counters are stored on the user document, so they survive the 30-day
  results cleanup.

## 9. Data storage

All data lives in **Cloud Firestore** (no local database):

| Data | Location |
|---|---|
| Users (bcrypt password, credits, role, lifetime counters, display ID) | `users/<emailLower>` |
| Verification runs + results (retained ~30 days; capped payloads) | `users/<emailLower>/batches/*` |
| Password-reset tokens (hashed, single-use, 1 h) | `password_resets/*` |
| Global counters (task numbers, user IDs) | `meta/counters` |
| Stripe webhook idempotency claims | `billing_events/*` |

## 10. Security

A full review was performed; recorded findings and fixes:

- **Critical — 2FA bypass fixed:** the pre-2FA `tempToken` is marked and
  rejected on every route except `/auth/2fa/verify`.
- **High — auth rate limiting:** per-IP limits on login, registration, 2FA,
  password reset, and billing endpoints.
- **High — atomic credits:** reservations happen in a Firestore transaction
  (no overspend under concurrency); non-chargeable results are refunded.
- **Medium — job caps:** `MAX_EMAILS_PER_JOB` (default 50,000) on every job,
  uploads capped at 15 MB / CSV-TXT only; column-mapping labels capped.
- **Medium — SSRF/DNS-rebinding guard:** MX hosts resolve to a public IP once
  and the SMTP socket connects to that vetted IP; private ranges blocked
  (`ALLOW_PRIVATE_MX=1` to opt out for internal servers).
- **Payments:** Stripe webhook is signature-verified (constant-time, multi-sig,
  5-minute timestamp tolerance) with per-event idempotency — replays and
  test-mode events never grant credits; checkout redirect origin can't be forged.
- **Also verified:** owner-scoped history/jobs, superadmins hidden from plain
  admins, no self role-change/delete, generic error responses, secrets
  git-ignored (`.env`, `serviceAccount.json`, `.jwt_secret`), CSV export
  neutralises formula injection, React output escaping (no raw-HTML sinks).
- **Bootstrap note:** the first registered account becomes superadmin — register
  the owner account right after deploying (or pre-set `SUPERADMIN_EMAIL`).

## 11. Environment variables (full reference)

**Backend — root `.env`** (template: `.env.example`; auto-loaded at startup)

| Var | Needed | Purpose |
|---|---|---|
| `NODE_ENV` | prod | `production` makes `JWT_SECRET` mandatory. |
| `PORT` | no | API port (default 3001). |
| `JWT_SECRET` | prod | Signs login tokens (48-byte hex recommended). |
| `CORS_ORIGINS` | cross-origin only | Comma-separated allowed frontend origins. |
| `FRONTEND_URL` | resets + Stripe | Base URL for reset links and checkout redirects. |
| `SUPERADMIN_EMAIL` / `ADMIN_EMAIL` | no | Promoted to that role at startup. |
| `FIREBASE_SERVICE_ACCOUNT` / `GOOGLE_APPLICATION_CREDENTIALS` | yes* | Firestore + Google sign-in (*or `serviceAccount.json` in root — auto-detected). |
| `SMTP_HOST/PORT/USER/PASS/FROM` | reset emails | Outgoing mail provider. |
| `VERIFY_HELO_DOMAIN` / `VERIFY_MAIL_FROM` | accuracy | Real probe identity for SMTP checks (see §4). |
| `VERIFY_CONCURRENCY` | no | Parallel SMTP checks per job (default 10). |
| `QUICK_CONCURRENCY` | no | Parallel checks for fast bounce mode (default 50). |
| `SMTP_TIMEOUT_MS` | no | Per-connection SMTP timeout (default 12000). |
| `MAX_EMAILS_PER_JOB` | no | Per-job address cap (default 50000). |
| `SPAMTRAP_DOMAINS` | no | Comma-separated extra spam-trap domains. |
| `ALLOW_PRIVATE_MX` | rare | `1` to allow private-IP mail servers (SSRF guard opt-out). |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | card payments | Stripe Checkout + webhook (see §5). |
| `WISE_PAYMENT_URL` / `WISE_EMAIL` | Wise | Shown on the Buy Credits page. |
| `BANK_HOLDER/NAME/ACCOUNT/IBAN/SWIFT/NOTES` | bank transfer | Shown on the Buy Credits page. |
| `BILLING_NOTIFY_EMAIL` | manual payments | Where payment-intent notices are emailed. |

**Frontend — `frontend/.env`** (template: `frontend/.env.example`)

| Var | Needed | Purpose |
|---|---|---|
| `VITE_API_URL` | prod cross-origin | API origin; **leave empty** for dev / same-origin proxy. |
| `VITE_FIREBASE_API_KEY/_AUTH_DOMAIN/_PROJECT_ID/_APP_ID` | Google sign-in | Firebase web config. |

## 12. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| "Cannot reach the server" on login | Backend not running, or `VITE_API_URL` wrongly set — leave it empty in dev and restart `npm run dev`. |
| Server exits: `JWT_SECRET must be set` | Production without a secret — set `JWT_SECRET` in `.env`. |
| Server exits: `[FATAL] Cloud Firestore is required` | Missing/invalid service account — see §3a. |
| Most results `unknown` ("Failed to connect to SMTP") | Outbound port 25 blocked — see §4; check `/health` → `port25`. |
| `Mail server resolves to a non-public address (blocked)` | SSRF guard hit an internal MX (expected); `ALLOW_PRIVATE_MX=1` only if intentional. |
| Google button errors | Firebase not configured, domain missing from Authorized domains, or env not reloaded (restart dev server). |
| "This account uses Google sign-in" | That email registered via Google — use the Google button or reset the password. |
| Reset email never arrives | No SMTP configured — the link is printed in the backend log (`pm2 logs`). |
| Card payment done (test mode) but no credits | By design — test-mode payments never add credits; only live-mode paid checkouts do. |
| Stripe paid (live) but no credits | Webhook not configured/reachable — check the endpoint URL and `STRIPE_WEBHOOK_SECRET`, then Stripe dashboard → webhook deliveries. |
| CORS error in browser | Add the frontend origin to `CORS_ORIGINS`, restart backend. |
| `.env` changes not applied | Env is read at startup — restart the process (Vite too). |
| `[History] FAILED to save ...` in logs | Firestore permission/quota problem — check the logged error. |

---

*This README is the project's single guide — the earlier separate docs
(setup, deployment, Firestore, accuracy, security, changelog) were merged
into it and removed.*

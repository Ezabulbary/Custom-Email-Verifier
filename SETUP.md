# BounceCure — Full Setup & Configuration Guide

A step-by-step guide, from a fresh machine to a running app, plus optional
Google sign-in, password-reset email, and production deployment.

> **TL;DR** — two processes must run: the **backend** (`node server.js`, port 3001)
> and the **frontend** (`npm run dev`, port 5173). Everything else below is detail.

---

## 0. Prerequisites

You need **Node.js 20 or newer** and npm (npm ships with Node).

```bash
node -v      # should print v20.x or higher
npm -v
```

If you don't have it, install from <https://nodejs.org> (LTS) or with nvm:

```bash
# macOS/Linux with nvm
nvm install 20
nvm use 20
```

**Project layout** (after you unzip the code):

```
Custom-Email-Verifier/
├── server.js            ← backend API (Express)
├── db.js                ← SQLite schema (users, history, password_resets)
├── firebaseAdmin.js     ← optional Google token verification
├── verifier.js, smtp.js, providers.js, disposable.js  ← verification engine
├── package.json         ← backend dependencies
├── .env.example         ← backend env template
├── SETUP.md             ← this file
└── frontend/            ← React app (Vite)
    ├── src/
    ├── package.json     ← frontend dependencies
    └── .env.example     ← frontend env template
```

---

## 1. Run the backend (Terminal 1)

```bash
cd Custom-Email-Verifier      # the project root
npm install                   # installs express, sqlite3, bcryptjs, firebase-admin, …
cp .env.example .env          # create your env file (edit it if you like)
node server.js                # starts the API on http://localhost:3001
```

On success you'll see:

```
[Auth] Firebase service account not set — Google sign-in disabled.
Email Verifier API running on port 3001
Connected to the SQLite database.
Disposable domains loaded. Ready to verify.
```

- The database file **`users.sqlite`** is created automatically on first run.
- `node server.js` does **not** auto-read `.env`. Either export the vars in your
  shell, or run `node --env-file=.env server.js` (Node 20+), or use a process
  manager (see §7). For local dev the defaults work without any `.env`.

Leave this terminal running.

---

## 2. Run the frontend (Terminal 2)

Open a **second** terminal:

```bash
cd Custom-Email-Verifier/frontend
npm install                   # installs react, react-router, firebase, …
cp .env.example .env          # create the frontend env file
npm run dev                   # starts Vite on http://localhost:5173
```

Open the printed URL — **http://localhost:5173**.

> **Important:** the frontend calls the backend at `VITE_API_URL`
> (default `http://localhost:3001`). If the backend in Terminal 1 isn't running,
> login/register will show **"Cannot reach the server."** — that's expected;
> start the backend.

---

## 3. Create your first account (and admin)

1. Go to **http://localhost:5173/register**.
2. Sign up with an email + password (min 8 characters).
3. The **first account that registers automatically becomes admin** and can
   open the **Admin Panel** (manage users and credits).

### Roles: superadmin, admin, user
There are three roles, highest to lowest: **superadmin › admin › user**.

- The **first account** to register automatically becomes **superadmin**.
- Force specific accounts via the backend `.env` (applied on restart, even for existing users):
  ```
  SUPERADMIN_EMAIL=you@yourcompany.com     # promoted to superadmin
  ADMIN_EMAIL=teammate@yourcompany.com     # promoted to admin
  ```

**Who can see whom** in the Admin Panel (enforced on the server, not just hidden in the UI):

| Viewer | Sees superadmins | Sees admins | Sees users |
|--------|:---:|:---:|:---:|
| superadmin | ✅ | ✅ | ✅ |
| admin | ❌ | ✅ | ✅ |
| user | — (no admin panel access) | | |

- Only a **superadmin** can grant/revoke the superadmin role or edit/delete a superadmin.
- An **admin** can manage users and admins, but never sees or touches superadmins.
- No one can change **their own** role (prevents lockout).

---

## 4. Where is my data stored?

| Data | Location | Table |
|------|----------|-------|
| Users (email, bcrypt-hashed password, credits, role) | `users.sqlite` (project root) | `users` |
| Verification history (single/bulk/CSV runs + results, 30 days) | `users.sqlite` | `history` |
| Password-reset tokens (hashed, single-use, 1h) | `users.sqlite` | `password_resets` |

`users.sqlite` is git-ignored, so it's never committed. Back it up like any DB
file. To wipe all local data during testing, stop the backend and delete
`users.sqlite` — it will be recreated empty.

---

## 5. Enable "Continue with Google" (optional)

Google sign-in uses **Firebase Authentication**. It's entirely optional — the
app works with email/password alone. When it isn't configured, clicking the
Google button just returns a friendly error; nothing breaks.

There are **three pieces**: create a Firebase project, add the web keys to the
**frontend**, and add a service account to the **backend**.

### 5A. Create the Firebase project (once)
1. Go to <https://console.firebase.google.com> → **Add project** → give it a name → create.
2. Left sidebar → **Build → Authentication** → **Get started**.
3. Tab **Sign-in method** → **Add new provider** → **Google** → toggle **Enable** → pick a support email → **Save**.
4. Tab **Settings → Authorized domains** → make sure **`localhost`** is listed (add your live domain later).

### 5B. Frontend web keys → `frontend/.env`
1. Firebase console → click the **⚙️ gear → Project settings**.
2. Scroll to **Your apps**. If there's no web app yet, click the **`</>` (Web)** icon, register an app (any nickname), and skip hosting.
3. You'll see a `firebaseConfig` object. Copy these values into `frontend/.env`:

```
VITE_API_URL=http://localhost:3001
VITE_FIREBASE_API_KEY=AIzaSyXXXXXXXXXXXXXXXXXXXXXXXXXXX
VITE_FIREBASE_AUTH_DOMAIN=your-app.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-app
VITE_FIREBASE_APP_ID=1:1234567890:web:abcdef123456
```

4. **Restart** `npm run dev` (Vite only reads `.env` at startup).

### 5C. Backend service account → root `.env`
The backend verifies the Google token server-side, which needs a service account:

1. Firebase console → **⚙️ Project settings → Service accounts** tab.
2. Click **Generate new private key** → confirm → a `.json` file downloads.
3. Give the backend access **one of two ways**:

   **Option 1 — save the file** as `serviceAccount.json` in the project root, then in `.env`:
   ```
   GOOGLE_APPLICATION_CREDENTIALS=./serviceAccount.json
   ```
   **Option 2 — paste the JSON** as a single line in `.env`:
   ```
   FIREBASE_SERVICE_ACCOUNT={"type":"service_account","project_id":"...", ... }
   ```
4. Restart the backend. Success looks like:
   ```
   [Auth] Firebase Admin initialised — Google sign-in enabled.
   ```

> `serviceAccount.json` and `.env` are git-ignored — **never commit them**.

**How it works:** browser gets a Google ID token → `POST /auth/google` → backend
verifies it with firebase-admin → finds or creates the user in `users.sqlite`
(no password, 100 credits, first user = admin) → issues the same app JWT used by
email/password. The rest of the app is unchanged.

---

## 6. Password reset email — make it actually send

The forgot-password flow works end-to-end and **email sending is built in**
(nodemailer). You only need to give it SMTP credentials.

**How the flow works:** user clicks **Forgot password?** → enters email →
backend stores a **single-use, 1-hour, hashed** token and builds a link
`FRONTEND_URL/reset-password?token=…` → the link is emailed to the user → they
open it and set a new password.

- **No SMTP set** → the link is printed to the **backend console** (fine for
  local testing — copy it into your browser).
- **SMTP set** → a real, styled email is sent automatically. Nothing else to code.

### Easiest option: Gmail (app password)
1. Enable 2-Step Verification on your Google account.
2. Create an app password: <https://myaccount.google.com/apppasswords> → copy the 16-character code.
3. In the root `.env`:
```
FRONTEND_URL=http://localhost:5173      # or your live app URL
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=you@gmail.com
SMTP_PASS=your16charapppassword         # the app password, NOT your Gmail login
SMTP_FROM=BounceCure <you@gmail.com>
```
4. Restart the backend. You'll see `[Mail] SMTP configured (smtp.gmail.com:587) — password-reset emails enabled.`
5. Test: on the login page click **Forgot password?**, enter your email, and check your inbox.

### Any other provider (SendGrid, Mailgun, SES, your host…)
Use the SMTP host/port/user/pass they give you. Port `465` uses SSL; `587` uses
STARTTLS — both are handled automatically. `SMTP_FROM` should be an address your
provider is allowed to send from.

> `FRONTEND_URL` must point to where the React app is served, so the reset link
> opens the right page (default `http://localhost:5173`).
>
> The email code lives in `mailer.js` (transport + HTML template) and is called
> from `deliverResetEmail()` in `server.js`. If sending fails, the backend logs
> the error and falls back to printing the link, so a mail outage never fully
> breaks resets.

---

## 7. Deploy to production

### 7A. Build the frontend
```bash
cd frontend
# point the build at your real API origin first:
#   VITE_API_URL=https://api.yourdomain.com   (or '' if same-origin behind nginx)
npm run build          # outputs static files to frontend/dist/
```
Serve `frontend/dist/` as static files (nginx, Netlify, Vercel, S3+CloudFront…).

### 7B. Run the backend
```bash
export NODE_ENV=production
export JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")
export CORS_ORIGINS=https://app.yourdomain.com
node server.js
# better: keep it alive with pm2
npm i -g pm2 && pm2 start server.js --name bouncecure-api
```

### 7C. Example nginx (frontend static + API proxy)
```nginx
server {
  server_name app.yourdomain.com;

  root /var/www/bouncecure/frontend/dist;
  location / { try_files $uri /index.html; }      # SPA fallback

  location /auth/ { proxy_pass http://127.0.0.1:3001; }
  location /verify { proxy_pass http://127.0.0.1:3001; }
  location /history { proxy_pass http://127.0.0.1:3001; }
  location /admin/ { proxy_pass http://127.0.0.1:3001; }
  location /health { proxy_pass http://127.0.0.1:3001; }
}
```
If you proxy the API on the same domain, set `VITE_API_URL=''` and rebuild.

> **SMTP note:** outbound email verification uses port 25. Many hosts block it —
> use a provider/VPS that allows outbound SMTP, or verification results may be
> "unknown".

### 7D. Production checklist
- [ ] `NODE_ENV=production` **and** a strong `JWT_SECRET` (required — the server refuses to start without it in production).
- [ ] `CORS_ORIGINS=https://app.yourdomain.com`
- [ ] `VITE_API_URL` set and frontend **rebuilt** (`npm run build`).
- [ ] `FRONTEND_URL` set (for reset links) and email provider wired in `deliverResetEmail()`.
- [ ] Your live domain added to Firebase **Authorized domains** (if using Google).
- [ ] `.env` and `serviceAccount.json` kept **out of git** (already git-ignored).
- [ ] `users.sqlite` on persistent disk and backed up.

---

## 8. Storage architecture (recommendation)

You asked about Firebase for users and Cloudinary for work history. The
production-correct split:

| Data | Best store | Why |
|------|-----------|-----|
| Users / auth | **Firebase Auth + Firestore** | Handles Google + email, sessions, resets. |
| Work / verification history | **Firestore** (`history` collection) | It's structured JSON — a database, not a file. |
| Exported CSV **files** (only if you host them) | **Cloudinary** or S3 | Cloudinary is a **media/file CDN** — good for files, **not** JSON history rows. |

**Bottom line:** put both users and history in Firebase (Firestore). Use
Cloudinary **only** if you later store generated CSV/report *files* as media.
Today the app keeps both in SQLite — perfectly fine for a single server; migrate
to Firestore when you need multi-instance scale. (To migrate history, replace
the `db.*` calls in the `server.js` history routes with firebase-admin Firestore
reads/writes using the same service account from §5C.)

---

## 9. All environment variables (quick reference)

**Backend — root `.env`** (template: `.env.example`)

| Var | Needed | Purpose |
|-----|--------|---------|
| `NODE_ENV` | prod | `production` on the live server (makes `JWT_SECRET` mandatory). |
| `PORT` | no | API port (default 3001). |
| `JWT_SECRET` | prod | Signs login tokens. Generate a random 48-byte hex string. |
| `CORS_ORIGINS` | prod | Comma-separated allowed frontend origins. |
| `ADMIN_EMAIL` | no | Email that becomes admin on startup. |
| `FRONTEND_URL` | for resets | Base URL used in password-reset links. |
| `FIREBASE_SERVICE_ACCOUNT` / `GOOGLE_APPLICATION_CREDENTIALS` | for Google | Service account (paste JSON, or path to file). |
| `SMTP_*` | for reset email | Your email provider (if you wire nodemailer). |
| `ALLOW_PRIVATE_MX` | rare | Set to 1 only to verify against private-IP mail servers. |

**Frontend — `frontend/.env`** (template: `frontend/.env.example`)

| Var | Needed | Purpose |
|-----|--------|---------|
| `VITE_API_URL` | yes | Backend API origin. |
| `VITE_FIREBASE_API_KEY` / `_AUTH_DOMAIN` / `_PROJECT_ID` / `_APP_ID` | for Google | Firebase web config. |

Also edit `BRAND.callUrl` in `frontend/src/App.jsx` — the "Book a quick call"
buttons open it (put your Calendly / Cal.com link there).

---

## 10. Troubleshooting

| Symptom | Cause / fix |
|---------|-------------|
| "Cannot reach the server" on login/register | Backend not running, or `VITE_API_URL` wrong. Start `node server.js`. |
| Backend exits: "FATAL: JWT_SECRET must be set" | `NODE_ENV=production` without `JWT_SECRET`. Set a secret (see §7B). |
| Google button does nothing / errors | Firebase not configured, or `localhost` missing from **Authorized domains**, or you didn't restart after editing `.env`. |
| "This account uses Google sign-in" on login | That email registered via Google (no password). Use **Continue with Google**, or reset the password. |
| Reset email never arrives | In dev the link is only **logged to the backend console**. In prod, wire `deliverResetEmail()` (see §6). |
| Verifications return "unknown" a lot | Outbound SMTP (port 25) is blocked by your host. Use a host that allows it. |
| CORS error in the browser console | Add your frontend origin to `CORS_ORIGINS` and restart the backend. |
| Changes to `.env` not taking effect | Restart the process — env is read at startup (Vite too). |

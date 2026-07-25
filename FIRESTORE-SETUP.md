# Firestore Setup — step by step

Your Firestore database is already created and **nothing needs to be done inside
the database** (no collections, no indexes, no security rules). The app creates
everything automatically on first use. You only need 2 things on the server.

## Step 1 — Download the service account key

1. Firebase console → **⚙️ Project settings → Service accounts**
2. Click **Generate new private key** → a JSON file downloads
3. Rename it to **`serviceAccount.json`** and put it in the **project root**
   (the same folder as `server.js`)

> The app **auto-detects** `serviceAccount.json` in the project root — you don't
> need to set `GOOGLE_APPLICATION_CREDENTIALS`. (It's already git-ignored, so it
> won't be committed.)

## Step 2 — `.env` (JWT secret)

Once `serviceAccount.json` is present, Firestore turns on **automatically** — you
do NOT need `USE_FIRESTORE=1`. All data then saves to Firestore only; SQLite is
not used (no `users.sqlite` is created).

Just set a `JWT_SECRET` in **`.env`** (project root):

```
JWT_SECRET=fe9067b9058955ee99f3fddd3a0372220b53cfcf795a68c3b31b878abec346acb2577d1f066a3c5122a02e5729a0268c
```

(The `JWT_SECRET` above was generated for you — keep it private. Generate your own
with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`.)

> To force local SQLite even with Firebase configured, set `USE_FIRESTORE=0`.

## Step 3 — Run

```
npm install        # if not done yet (installs firebase-admin etc.)
node server.js
```

`.env` loads automatically (no `--env-file` flag needed).

## How to confirm it worked

The startup log should show:

```
[Auth] Using ./serviceAccount.json
[Auth] Firebase Admin initialised — Google sign-in enabled.
[Store] Cloud Firestore enabled — all data will be stored in Firestore.
[Store] Active data store: FIRESTORE
```

Open `http://localhost:3001/health` → it returns `{"status":"ok","store":"firestore"}`.

After you register a user or run a verification, refresh the Firestore **Data**
tab — you'll see the `users` collection (and `users/<email>/batches`) appear.

## Notes

- **SQLite ↔ Firestore are separate stores.** Switching does not copy old data.
  Since you're starting fresh, that's fine.
- To go back to SQLite, remove `USE_FIRESTORE=1` (or set it to `0`).
- If the log says `Active data store: SQLITE`, check that (a) `serviceAccount.json`
  is in the project root, and (b) `USE_FIRESTORE=1` is in `.env`. The startup log
  prints exactly why it fell back.

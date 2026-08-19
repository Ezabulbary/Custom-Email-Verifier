# What's New — Pricing-matched billing, lifetime admin history, security pass

Latest update (v31):

- **Buy Credits now mirrors the pricing page**: Starter $19 → 10,000 credits,
  Pro $49 → 50,000 credits (Free = the 100-credit signup bonus). The landing
  page's "Choose Starter/Pro" buttons go straight to `/dashboard/billing`.
- **Automatic payments**: a REAL (live-mode) Stripe payment that completes as
  `paid` adds credits automatically via the signature-verified webhook.
  **Test-mode events never add credits**, replays/duplicates are rejected
  (5-minute timestamp tolerance + per-event idempotency claim), and multiple
  webhook signatures (secret rolls) are handled.
- **Admin Panel — lifetime user history**: every account now has a permanent
  display ID built from the joining date + a unique number (`BC-YYYYMMDD-NNNN`).
  The users table shows ID, Joined, Email, Role, Add Credits, **Total Credits**
  (balance + used), **Used Credits**, Actions — and clicking a row (anywhere
  except the credit/actions controls) opens that user's history page
  (`/admin/user/:id`) with a Back button, lifetime stat cards (balance, used,
  total, lifetime verifications/executions) and their stored executions.
  Lifetime counters live on the user document so they survive the 30-day
  batch cleanup. Existing accounts are backfilled automatically.
- **Security pass over all pages/endpoints** (fixes applied):
  webhook replay/duplicate protection; `/billing/checkout` no longer trusts a
  forged `Origin` header (FRONTEND_URL / CORS allow-list only); column-mapping
  `labels` capped (256 columns × 120 chars); billing endpoints rate-limited.
  Verified: every data endpoint requires auth, admin endpoints re-check the
  live role from the DB, pre-2FA tokens are rejected outside `/auth/2fa/verify`,
  job status/history are owner-scoped, superadmin accounts stay hidden from
  plain admins (including the new history endpoint), task deletion remains
  superadmin-only, CSV export neutralises formula injection, and no raw-HTML
  sinks exist in the frontend.

---

# Catch-All Verifier + Buy Credits

Earlier update (v30):

- **Catch-All Verifier** (`/dashboard/catchall`): a dedicated tool for the hard
  case — catch-all domains, which accept every address. It deep-resolves each
  address using Microsoft 365 signals and SMTP reply-differencing, so a catch-all
  can come back **deliverable** (safe/role) instead of just "risky". Addresses
  that aren't catch-all are marked `not_catch_all` (and never charged) so you
  verify them with the standard tool. Single / paste / file (with column mapping)
  inputs, plus a Deliverable / Still-catch-all / Undeliverable / Not-catch-all
  summary. Backend: `verifyCatchAll()` + `/catchall`, `/catchall/bulk`,
  `/catchall/csv`.
- **Buy Credits page** (`/dashboard/billing`): four credit packs and three
  payment methods — **Stripe** (card, instant, via Stripe Checkout + a
  signature-verified webhook that grants credits), **Wise**, and **international
  bank transfer**. Manual methods return a payment reference and notify ops; an
  admin grants the credits once the transfer clears. All billing config is env-
  driven (see `.env.example`): `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
  `WISE_*`, `BANK_*`, `BILLING_NOTIFY_EMAIL`.

---

# Fine-grained statuses, column-mapping, real Bounce Rate

Earlier update (v26):

- **Fine-grained verification statuses** (idea inspired by Reoon, built for this
  app): every result now returns one of `safe`, `role`, `catch-all`,
  `disposable`, `invalid`, `inbox_full`, `disabled`, `spamtrap`, `unknown` —
  instead of the old coarse valid/invalid. Deliverable mailboxes split into
  **safe** (personal) vs **role** (support@, info@, …); SMTP replies are parsed
  to detect **inbox_full** (over quota) and **disabled/suspended** accounts;
  known spam-trap domains (via `SPAMTRAP_DOMAINS`) return **spamtrap**. Credits
  are charged for every definitive status (only `unknown` is free/refunded).
- **Column-mapping modal on file upload**: after picking a CSV/TXT, a popup
  previews the first rows and lets you map which column is the email, confirm
  whether the first row is a header, and choose whether to remove duplicate
  emails — then **Start Verification**. Mapped column labels carry through to the
  exported results.
- **Bounce Rate now does real mailbox-level verification** (syntax + MX + SMTP +
  catch-all), so it reflects actual deliverability instead of only checking the
  domain. It stays **free** (no credits).

---

# Reorganization + Cloud Firestore

This update reorganizes the tool (inspired by Reoon's dashboard) and adds an
optional **Cloud Firestore** data store.

## 1. Hybrid data store (SQLite ↔ Firestore)

All data access now goes through a single abstraction, `store.js`, which picks
its backend automatically:

| Condition | Store used |
|-----------|-----------|
| `USE_FIRESTORE=1` **and** a Firebase service account is configured | **Cloud Firestore** |
| otherwise (default) | **local SQLite** (`users.sqlite`) |

If `USE_FIRESTORE=1` but Firestore can't initialise, the app logs a warning and
**falls back to SQLite** — so it never fails to start. The active store is
printed at boot: `[Store] Active data store: SQLITE|FIRESTORE`, and also
returned by `GET /health`.

### What is stored where

- **User credentials** — email, **bcrypt-hashed** password (never plaintext),
  credits, role, created-at.
- **Verification batches** — every single / bulk / CSV execution is saved as
  one batch, tagged with a **per-user sequential batch number** and an optional
  **task name**, and retained for **~30 days** (then auto-deleted).

### Firestore layout

```
users/{emailLower}                    → user document (id = lowercased email)
users/{emailLower}/batches/{autoId}   → one execution batch (number, counts, results)
password_resets/{tokenHash}           → single-use reset token
```

### Enabling Firestore

1. In the [Firebase console](https://console.firebase.google.com): **Build →
   Firestore Database → Create database**.
2. Make sure a service account is set (same one used for Google sign-in):
   `FIREBASE_SERVICE_ACCOUNT=...` **or** `GOOGLE_APPLICATION_CREDENTIALS=./serviceAccount.json`.
3. Set `USE_FIRESTORE=1` in your backend `.env`.
4. Start the backend with env loaded: `node --env-file=.env server.js`.

> Note: SQLite and Firestore are **separate** stores — switching does not copy
> existing data across. Pick one before you have real users, or migrate manually.

## 2. Reorganized dashboard (Reoon-style)

- **Overview** — credits, 30-day emails verified, lists cleaned, valid-rate, and
  a **Usage Statistics donut** (Valid / Catch-all / Disposable / Invalid / Unknown).
- **Single / Bulk / Clean-a-List** — Bulk and CSV now accept an optional
  **Task Name** (like Reoon).
- **Tasks & Results** — a new page listing every execution batch: batch number,
  date, task name, type, status, total, per-status breakdown, with **filter
  tabs**, **pagination**, expandable details and per-batch **CSV download**
  (results are lazy-loaded from `GET /history/:id`).

## API changes

| Endpoint | Change |
|----------|--------|
| `POST /verify`, `/verify/bulk`, `/verify/csv` | accept optional `name`; response includes `batchId`, `batchNumber` |
| `GET /history` | now returns batch **summaries** (no per-address results); each item has `batchNumber`, `name`, `counts.disposable` |
| `GET /history/:id` | **new** — full results for one batch (Details / Download) |
| `GET /history/stats/overview` | replaces `GET /history/stats`; adds `counts.disposable` |
| `GET /health` | now also returns the active `store` |

Everything is backward-compatible on SQLite: existing databases are migrated
automatically (new `batch_number`, `name`, `disposable_count` columns are added
on startup).

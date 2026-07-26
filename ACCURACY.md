# Why accuracy is low, and how to reach 90–95%

## The core reason: outbound port 25

Email verification confirms a mailbox exists by connecting to the recipient's
mail server and starting an SMTP conversation (`MAIL FROM` / `RCPT TO`). That
connection uses **outbound TCP port 25**.

**Almost every cloud/VPS provider blocks outbound port 25 by default** (AWS,
Google Cloud, Azure, DigitalOcean, Oracle, most shared hosts). When it's blocked:

- `checkSMTP()` can't connect → the result is **`unknown`**, not `valid`.
- So most addresses come back `unknown`, and only the ones we can judge without
  SMTP (bad syntax, no MX, disposable, or Microsoft 365 via its HTTPS API) get a
  definite verdict. That's the ~20–25% you're seeing.

The server now **probes port 25 at startup** and prints a big warning if it's
blocked, and `GET /health` returns `"port25": true|false`. Check your server log
or `curl https://your-domain/health`.

## To reach 90–95% accuracy — pick one

### Option A — Unblock outbound port 25 (best; free)
Run the backend on a host that allows port 25, or ask your provider to unblock
it. Some VPS providers (e.g. certain Hetzner/OVH/Contabo plans) allow it or
unblock on request after a quick anti-abuse check. Once open, the built-in
verifier gives real mailbox-level results for Gmail, Outlook, Yahoo, custom
domains, etc. Confirm with `/health` showing `"port25": true`.

> Tip: even with port 25 open, use a clean IP with proper reverse DNS (PTR) and
> an SPF record for the probe domain, or some servers greylist/deny the probe.

### Option B — Use a verification API (works even with port 25 blocked)
Route verification through a provider that already has port-25 infrastructure —
e.g. **Reoon** (you already have an API key), ZeroBounce, NeverBounce, etc. This
gives 95%+ without any port/networking work, but costs credits per check.

If you want this, I can add a pluggable provider: set `VERIFY_PROVIDER=reoon`
and `VERIFY_API_KEY=...`, and the backend calls that API instead of doing SMTP
itself. Tell me which provider and I'll wire it in.

### Option C — Stay with the built-in checks
Without port 25 or an API, the honest ceiling is syntax + MX + disposable +
catch-all heuristics + Microsoft 365. Useful for filtering obvious junk, but it
cannot confirm most real mailboxes — accuracy stays limited.

## Not the cause
- DNS/MX lookups work fine here and on your server.
- The verifier logic is correct; it's the network path (port 25) that's missing.

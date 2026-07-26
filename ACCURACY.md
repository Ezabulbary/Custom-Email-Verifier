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

### Option A — Port 25 open (best; free) ✅ you have this
Confirm with `/health` showing `"port25": true`. With port 25 open the built-in
verifier gives real mailbox-level results — but to actually reach 90–95% you must
also make mail servers TRUST your probe, or Gmail/Outlook greylist it and return
"unknown":

1. **Use a real HELO/MAIL FROM domain** (this is the big one). In `.env`:
   ```
   VERIFY_HELO_DOMAIN=mail.yourdomain.com
   VERIFY_MAIL_FROM=verify@yourdomain.com
   ```
   Use a domain you actually own — not the placeholder `verify.example.com`.
2. **Reverse DNS (PTR)** for your server's IP should resolve to that host
   (`VERIFY_HELO_DOMAIN`). Ask your VPS provider to set the PTR record. Mail
   servers heavily weight a matching PTR.
3. **SPF record** on that domain listing your server IP helps acceptance.
4. Keep `VERIFY_CONCURRENCY` moderate (default 10). If you see lots of "unknown"
   from one provider, it's rate-limiting — lower it.

After setting these, re-run a small test list. Valid/invalid rates should jump.

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

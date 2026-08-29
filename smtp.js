const net = require('net');

const SMTP_PORT = 25;
const TIMEOUT_MS = Number(process.env.SMTP_TIMEOUT_MS) || 12000;

// IMPORTANT for accuracy: mail servers (Gmail, Outlook, …) judge the connecting
// server by its HELO name and MAIL FROM. A fake domain gets greylisted/blocked
// and returns "unknown". Set VERIFY_HELO_DOMAIN to a REAL domain you control
// (ideally the reverse-DNS/PTR of this server's IP, with an SPF record), and
// VERIFY_MAIL_FROM to a real-looking sender on it. See README.md §4.
// If you have no domain yet, you can HELO with your server's public IP — but
// SMTP (RFC 5321) requires an IP literal to be bracketed, e.g. `[187.127.113.86]`.
// Auto-bracket a bare IPv4 so `VERIFY_HELO_DOMAIN=187.127.113.86` still works.
// (A real domain with matching PTR + SPF is still far better for accuracy.)
const rawHelo = (process.env.VERIFY_HELO_DOMAIN || 'verify.example.com').trim();
const HELO_DOMAIN = /^\d{1,3}(\.\d{1,3}){3}$/.test(rawHelo) ? `[${rawHelo}]` : rawHelo;
// MAIL FROM can't use a bracketed IP as its domain; fall back to a plain sender
// on the raw value (or the configured VERIFY_MAIL_FROM).
const MAIL_FROM = (process.env.VERIFY_MAIL_FROM || `verify@${rawHelo}`).trim();

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Verify MULTIPLE recipients over ONE TCP connection, but each recipient in its
// OWN transaction: greeting -> EHLO/HELO -> then for each recipient
// (MAIL FROM -> RCPT TO -> record the reply -> RSET) -> QUIT.
//
// Why a transaction per recipient (RSET between them) instead of one MAIL FROM
// with back-to-back RCPTs: many mail servers accept the FIRST RCPT in a
// transaction and then defer (4xx) or silently drop every RCPT after it, to stop
// address enumeration. Cramming the real address + the random catch-all probes
// into a single transaction therefore lost the probes (and often the connection)
// after the first RCPT, so catch-all could never be confirmed and the result
// collapsed to "unknown". Issuing RSET + a fresh MAIL FROM before each RCPT makes
// every probe its own clean transaction — the natural, well-supported shape — so
// each recipient gets a real answer while still paying for only one connection
// (which is what avoids the per-connection rate-limiting).
//
// Returns { connected, results } where results[i] = { code, message, connected }
// aligned to recipients[i]. `connected` (session-level) is true once the first
// MAIL FROM was accepted (the RCPT phase actually ran). `connectHost`, when
// provided, is the pre-validated public IP to dial (the caller resolves the MX
// hostname once and passes the vetted IP here, so this function never triggers a
// second, unchecked DNS lookup — that would reopen a DNS-rebinding SSRF).
async function checkSMTPMulti(mxRecord, recipients, connectHost = null) {
    await delay(100 + Math.random() * 200);

    return new Promise((resolve) => {
        const socket = new net.Socket();
        let buffer = '', pending = null, sessionOk = false, settled = false;
        const results = recipients.map(() => ({ code: 0, message: '', connected: false }));

        const finish = (extra) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            try { socket.write('QUIT\r\n'); } catch { /* socket already gone */ }
            try { socket.destroy(); } catch { /* already closed */ }
            resolve({ connected: sessionOk, results, ...(extra || {}) });
        };
        const timeout = setTimeout(() => finish({ message: 'Connection timeout' }), TIMEOUT_MS);
        // Register the callback for the NEXT complete reply, then write the command.
        const expect = (fn) => { pending = fn; };
        const send = (cmd, fn) => { expect(fn); socket.write(cmd + '\r\n'); };

        // One clean transaction for recipients[i]: MAIL FROM -> RCPT TO -> RSET.
        const probeRecipient = (i) => {
            send(`MAIL FROM:<${MAIL_FROM}>`, (mfCode) => {
                if (mfCode !== 250) return finish({ message: 'MAIL FROM rejected' });
                sessionOk = true;
                send(`RCPT TO:<${recipients[i]}>`, (code, line) => {
                    results[i] = { code, message: line.trim(), connected: true };
                    const next = i + 1;
                    if (next < recipients.length) send('RSET', () => probeRecipient(next));
                    else finish();
                });
            });
        };

        const startSession = () => {
            send(`EHLO ${HELO_DOMAIN}`, (ehloCode) => {
                if (ehloCode === 250) return probeRecipient(0);
                // Some servers only speak HELO; 252 = "cannot VRFY but will accept".
                send(`HELO ${HELO_DOMAIN}`, (heloCode) => {
                    if (heloCode !== 250 && heloCode !== 252) return finish({ message: 'EHLO/HELO rejected' });
                    probeRecipient(0);
                });
            });
        };

        socket.on('data', (data) => {
            buffer += data.toString();
            // An SMTP reply may span multiple lines / TCP chunks. "NNN-..." is a
            // continuation; "NNN ..." (space at index 3) is the final line.
            let nl;
            while ((nl = buffer.indexOf('\n')) !== -1) {
                const line = buffer.slice(0, nl).replace(/\r$/, '');
                buffer = buffer.slice(nl + 1);
                if (line.length < 3) continue;
                const code = parseInt(line.substring(0, 3), 10);
                if (Number.isNaN(code)) continue;
                if (line.charAt(3) === '-') continue;   // continuation line
                const cb = pending; pending = null;
                if (cb) cb(code, line);
            }
        });
        socket.on('error', (err) => finish({ message: err.message }));
        socket.on('close', () => finish());
        socket.connect(SMTP_PORT, connectHost || mxRecord);

        // First reply expected is the 220 greeting.
        expect((code) => {
            if (code !== 220) return finish({ message: 'Unexpected greeting' });
            startSession();
        });
    });
}

module.exports = { checkSMTPMulti };

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

// `connectHost`, when provided, is the pre-validated public IP to dial (the
// caller resolves the MX hostname once and passes the vetted IP here, so this
// function never triggers a second, unchecked DNS lookup — that would reopen a
// DNS-rebinding SSRF). Falls back to the hostname if no IP is supplied.
async function checkSMTP(mxRecord, targetEmail, isCatchAllCheck = false, connectHost = null) {
    // Add random delay between 100ms and 300ms to reduce rate-limiting
    await delay(100 + Math.random() * 200);

    return new Promise((resolve) => {
        const socket = new net.Socket();
        let step = 0;
        let heloTried = false;
        let resultCode = 0;
        let resultMessage = '';
        let buffer = '';

        const timeout = setTimeout(() => {
            socket.destroy();
            resolve({ code: 0, connected: false, message: 'Connection timeout' });
        }, TIMEOUT_MS);

        const sendCommand = (cmd) => {
            socket.write(cmd + '\r\n');
        };

        // Handle one complete SMTP reply (final line of a possibly multiline response)
        const handleReply = (code, line) => {
            switch(step) {
                case 0: // Expecting 220 Greeting
                    if (code === 220) {
                        step++;
                        sendCommand(`EHLO ${HELO_DOMAIN}`);
                    } else {
                        socket.destroy();
                        resolve({ code, connected: true, message: 'Unexpected greeting' });
                    }
                    break;
                case 1: // Expecting 250 from EHLO (fall back to HELO once)
                    if (code === 250) {
                        step++;
                        sendCommand(`MAIL FROM:<${MAIL_FROM}>`);
                    } else if (!heloTried) {
                        heloTried = true;                     // some servers only speak HELO
                        sendCommand(`HELO ${HELO_DOMAIN}`);
                    } else {
                        socket.destroy();
                        resolve({ code, connected: true, message: 'EHLO/HELO rejected' });
                    }
                    break;
                case 2: // Expecting 250 from MAIL FROM
                    if (code === 250) {
                        step++;
                        sendCommand(`RCPT TO:<${targetEmail}>`);
                    } else {
                        socket.destroy();
                        resolve({ code, connected: true, message: 'MAIL FROM rejected' });
                    }
                    break;
                case 3: // Expecting response from RCPT TO
                    resultCode = code;
                    resultMessage = line.trim();
                    step++;
                    sendCommand('QUIT');
                    break;
                case 4: // Expecting 221 from QUIT
                    socket.destroy();
                    break;
            }
        };

        socket.on('data', (data) => {
            buffer += data.toString();

            // An SMTP reply may span multiple lines and multiple TCP chunks.
            // Process each complete line: "NNN-..." is a continuation, while
            // "NNN ..." (space at index 3) marks the final line of the reply.
            let newlineIndex;
            while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
                const line = buffer.slice(0, newlineIndex).replace(/\r$/, '');
                buffer = buffer.slice(newlineIndex + 1);

                if (line.length < 3) continue;
                const code = parseInt(line.substring(0, 3), 10);
                if (Number.isNaN(code)) continue;

                // Continuation line of a multiline reply -> keep reading.
                if (line.charAt(3) === '-') continue;

                handleReply(code, line);
            }
        });

        socket.on('error', (err) => {
            clearTimeout(timeout);
            resolve({ code: 0, connected: false, message: err.message });
        });

        socket.on('close', () => {
            clearTimeout(timeout);
            if (step >= 3) {
                resolve({ code: resultCode, connected: true, message: resultMessage });
            } else {
                resolve({ code: 0, connected: false, message: 'Connection closed prematurely' });
            }
        });

        socket.connect(SMTP_PORT, connectHost || mxRecord);
    });
}

// Verify MULTIPLE recipients in ONE SMTP session: greeting -> EHLO/HELO ->
// MAIL FROM -> RCPT TO for each recipient (collecting each reply) -> QUIT.
//
// Why this matters: opening a fresh connection per recipient (real address, then
// separate catch-all probes) makes mail servers rate-limit/greylist the extra
// connections, so probes came back 4xx and catch-all could never be confirmed.
// Once MAIL FROM + the first RCPT succeed, later RCPTs in the SAME session get
// real answers, so a catch-all domain reliably accepts the random probe here.
//
// Returns { connected, results } where results[i] = { code, message, connected }
// aligned to recipients[i]. `connected` (session-level) is true once MAIL FROM
// was accepted (the RCPT phase actually ran).
async function checkSMTPMulti(mxRecord, recipients, connectHost = null) {
    await delay(100 + Math.random() * 200);

    return new Promise((resolve) => {
        const socket = new net.Socket();
        let step = 0, heloTried = false, buffer = '', ri = 0, sessionOk = false, settled = false;
        const results = recipients.map(() => ({ code: 0, message: '', connected: false }));

        const finish = (extra) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            try { socket.destroy(); } catch { /* already closed */ }
            resolve({ connected: sessionOk, results, ...(extra || {}) });
        };
        const timeout = setTimeout(() => finish({ message: 'Connection timeout' }), TIMEOUT_MS);
        const send = (cmd) => socket.write(cmd + '\r\n');

        const handleReply = (code, line) => {
            switch (step) {
                case 0: // greeting
                    if (code === 220) { step = 1; send(`EHLO ${HELO_DOMAIN}`); }
                    else finish({ message: 'Unexpected greeting' });
                    break;
                case 1: // EHLO (HELO fallback once)
                    if (code === 250) { step = 2; send(`MAIL FROM:<${MAIL_FROM}>`); }
                    else if (!heloTried) { heloTried = true; send(`HELO ${HELO_DOMAIN}`); }
                    else finish({ message: 'EHLO/HELO rejected' });
                    break;
                case 2: // MAIL FROM
                    if (code === 250) { sessionOk = true; step = 3; send(`RCPT TO:<${recipients[ri]}>`); }
                    else finish({ message: 'MAIL FROM rejected' });
                    break;
                case 3: // one RCPT reply per recipient
                    results[ri] = { code, message: line.trim(), connected: true };
                    ri++;
                    if (ri < recipients.length) send(`RCPT TO:<${recipients[ri]}>`);
                    else { step = 4; send('QUIT'); }
                    break;
                case 4: // QUIT
                    finish();
                    break;
            }
        };

        socket.on('data', (data) => {
            buffer += data.toString();
            let nl;
            while ((nl = buffer.indexOf('\n')) !== -1) {
                const line = buffer.slice(0, nl).replace(/\r$/, '');
                buffer = buffer.slice(nl + 1);
                if (line.length < 3) continue;
                const code = parseInt(line.substring(0, 3), 10);
                if (Number.isNaN(code)) continue;
                if (line.charAt(3) === '-') continue;   // continuation line
                handleReply(code, line);
            }
        });
        socket.on('error', (err) => finish({ message: err.message }));
        socket.on('close', () => finish());
        socket.connect(SMTP_PORT, connectHost || mxRecord);
    });
}

module.exports = { checkSMTP, checkSMTPMulti };

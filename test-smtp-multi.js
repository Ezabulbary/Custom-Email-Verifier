// Integration test for checkSMTPMulti against a LOCAL fake SMTP server.
// Proves the RSET-per-recipient flow works, and specifically that a server which
// only allows ONE RCPT per transaction (the anti-enumeration behavior that broke
// the old single-transaction code) now answers every recipient correctly.
// Run: node test-smtp-multi.js
const net = require('net');
process.env.VERIFY_HELO_DOMAIN = 'test.local';
process.env.VERIFY_MAIL_FROM = 'probe@test.local';
process.env.SMTP_TIMEOUT_MS = '4000';
const { checkSMTPMulti } = require('./smtp');

let pass = 0, fail = 0;
const t = (name, got, exp) => { got === exp ? (pass++, console.log('  ✓ ' + name)) : (fail++, console.log(`  ✗ ${name} got=${JSON.stringify(got)} exp=${JSON.stringify(exp)}`)); };

// A fake MTA. `mode` controls how it answers RCPT TO:
//   'oneRcptPerTxn' : accept the first RCPT of a transaction, but reply 421 and
//                     drop the connection on a SECOND RCPT in the SAME MAIL FROM
//                     (this is what defeated the old back-to-back-RCPT code).
//   'catchall'      : 250 for every RCPT.
//   'reject'        : 550 for a probe local-part starting 'zz', 250 otherwise.
function fakeServer(mode) {
    return new Promise((resolve) => {
        const srv = net.createServer((sock) => {
            let rcptInTxn = 0;
            sock.setEncoding('ascii');
            sock.write('220 fake ESMTP\r\n');
            let buf = '';
            sock.on('data', (d) => {
                buf += d;
                let nl;
                while ((nl = buf.indexOf('\n')) !== -1) {
                    const line = buf.slice(0, nl).replace(/\r$/, '');
                    buf = buf.slice(nl + 1);
                    const cmd = line.toUpperCase();
                    if (cmd.startsWith('EHLO') || cmd.startsWith('HELO')) sock.write('250 ok\r\n');
                    else if (cmd.startsWith('MAIL FROM')) { rcptInTxn = 0; sock.write('250 ok\r\n'); }
                    else if (cmd.startsWith('RSET')) { rcptInTxn = 0; sock.write('250 ok\r\n'); }
                    else if (cmd.startsWith('RCPT TO')) {
                        rcptInTxn++;
                        const addr = (line.match(/<([^>]*)>/) || [])[1] || '';
                        const localIsProbe = addr.split('@')[0].startsWith('zz');
                        if (mode === 'oneRcptPerTxn') {
                            if (rcptInTxn > 1) { sock.write('421 too many recipients, closing\r\n'); sock.destroy(); return; }
                            sock.write('250 accepted\r\n');
                        } else if (mode === 'catchall') {
                            sock.write('250 accepted\r\n');
                        } else if (mode === 'reject') {
                            sock.write(localIsProbe ? '550 no such user\r\n' : '250 accepted\r\n');
                        }
                    }
                    else if (cmd.startsWith('QUIT')) { sock.write('221 bye\r\n'); sock.destroy(); }
                    else sock.write('250 ok\r\n');
                }
            });
            sock.on('error', () => {});
        });
        srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port }));
    });
}

// checkSMTPMulti dials SMTP_PORT (25); point it at our ephemeral port by passing
// the port through a tiny shim: we temporarily override net.Socket.connect.
function withPort(port, fn) {
    const orig = net.Socket.prototype.connect;
    net.Socket.prototype.connect = function (p, host, cb) { return orig.call(this, port, '127.0.0.1', cb); };
    return Promise.resolve(fn()).finally(() => { net.Socket.prototype.connect = orig; });
}

(async () => {
    console.log('checkSMTPMulti integration (RSET-per-recipient):');

    // The critical regression: a server that drops a 2nd RCPT in one transaction.
    let f = await fakeServer('oneRcptPerTxn');
    let r = await withPort(f.port, () => checkSMTPMulti('mx', ['real@d.test', 'zzprobe1@d.test', 'zzprobe2@d.test']));
    f.srv.close();
    t('one-RCPT-per-txn: session connected', r.connected, true);
    t('one-RCPT-per-txn: real address answered 250', r.results[0].code, 250);
    t('one-RCPT-per-txn: probe 1 STILL answered (RSET saved it)', r.results[1].code, 250);
    t('one-RCPT-per-txn: probe 2 STILL answered', r.results[2].code, 250);

    f = await fakeServer('catchall');
    r = await withPort(f.port, () => checkSMTPMulti('mx', ['a@d.test', 'zzx@d.test']));
    f.srv.close();
    t('catch-all: every RCPT 250', r.results.every(x => x.code === 250), true);

    f = await fakeServer('reject');
    r = await withPort(f.port, () => checkSMTPMulti('mx', ['real@d.test', 'zzx@d.test']));
    f.srv.close();
    t('reject: real 250', r.results[0].code, 250);
    t('reject: probe 550 (server distinguishes real from fake)', r.results[1].code, 550);

    console.log(`\n=== ${pass} passed, ${fail} failed ===`);
    process.exit(fail ? 1 : 0);
})();

// Unit test for the single-session SMTP verification logic in verifier.js.
// Mocks dns + smtp so verifyEmail can be driven through every branch offline.
// Run: node test-verify-session.js
const Module = require('module');
const origRequire = Module.prototype.require;
let scenario = null; // (email, index) -> { code, message, connected }

const fakeDns = {
  setServers: () => {},
  promises: {
    resolveMx: async () => [{ exchange: 'mx.test', priority: 10 }],
    lookup: async (h, opts) => (opts && opts.all ? [{ address: '93.184.216.34', family: 4 }] : { address: '93.184.216.34' }),
  },
};
Module.prototype.require = function (id) {
  if (id === 'dns') return fakeDns;
  if (id === './smtp') return {
    checkSMTPMulti: async (host, recips) => ({
      connected: scenario(recips[0], 0).connected,
      results: recips.map((e, i) => scenario(e, i)),
      message: '',
    }),
  };
  if (id === './providers') return { detectProvider: () => 'generic', checkMicrosoft365: async () => ({ exists: null }) };
  if (id === './disposable') return { isDisposable: () => false };
  return origRequire.apply(this, arguments);
};

const { verifyEmail } = require('./verifier');

let pass = 0, fail = 0;
const t = (name, got, exp) => { got === exp ? (pass++, console.log('  ✓ ' + name)) : (fail++, console.log(`  ✗ ${name} got=${got} exp=${exp}`)); };

// Random probes always use a 'zz' local-part (see randomLocalPart in verifier.js),
// so scenarios distinguish the real address from a probe by the local-part rather
// than by RCPT index — the dedicated catch-all retry re-sends probes at index 0.
const isProbe = (e) => String(e).split('@')[0].startsWith('zz');

(async () => {
  console.log('Single-session verify (catch-all detection + no-false-unknown):');

  scenario = () => ({ code: 250, message: 'OK', connected: true });
  let r = await verifyEmail('a@catchall.test');
  t('every RCPT 250 -> catch-all', r.status, 'catch-all');
  t('  isCatchAll flag set', r.isCatchAll, true);

  scenario = (e) => (isProbe(e) ? { code: 550, message: 'No such user', connected: true } : { code: 250, message: 'OK', connected: true });
  r = await verifyEmail('real@normalA.test');
  t('real 250 + random 550 -> safe (real mailbox)', r.status, 'safe');

  scenario = (e) => (isProbe(e) ? { code: 250, connected: true, message: '' } : { code: 550, message: 'No such user', connected: true });
  r = await verifyEmail('nope@normalB.test');
  t('real 550 -> invalid', r.status, 'invalid');

  // Real accepted (250), every probe greylisted (4xx) in BOTH the inline session
  // and the dedicated retry: catch-all stays unproven, but the accepted 250 must
  // NOT be thrown away as 'unknown' — it is deliverable (the key fix here).
  scenario = (e) => (isProbe(e) ? { code: 451, message: 'greylisted', connected: true } : { code: 250, message: 'OK', connected: true });
  r = await verifyEmail('x@greyC.test');
  t('real 250 + probes greylisted -> safe (accepted, deliverable)', r.status, 'safe');
  t('  confidence reduced (catch-all unconfirmed)', r.confidence, 55);

  scenario = () => ({ code: 0, message: 'Connection timeout', connected: false });
  r = await verifyEmail('x@deadD.test');
  t('no SMTP reply -> unknown', r.status, 'unknown');

  scenario = (e) => (isProbe(e) ? { code: 250, connected: true, message: '' } : { code: 452, message: '4.2.2 mailbox is full', connected: true });
  r = await verifyEmail('full@quotaE.test');
  t('real 452 over-quota -> inbox_full', r.status, 'inbox_full');

  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail ? 1 : 0);
})();

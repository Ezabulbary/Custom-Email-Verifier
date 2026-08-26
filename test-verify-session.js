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

(async () => {
  console.log('Single-session verify (catch-all detection is the key fix):');

  scenario = () => ({ code: 250, message: 'OK', connected: true });
  let r = await verifyEmail('a@catchall.test');
  t('every RCPT 250 -> catch-all', r.status, 'catch-all');
  t('  isCatchAll flag set', r.isCatchAll, true);

  scenario = (e, i) => (i === 0 ? { code: 250, message: 'OK', connected: true } : { code: 550, message: 'No such user', connected: true });
  r = await verifyEmail('real@normalA.test');
  t('real 250 + random 550 -> safe (real mailbox)', r.status, 'safe');

  scenario = (e, i) => (i === 0 ? { code: 550, message: 'No such user', connected: true } : { code: 250, connected: true, message: '' });
  r = await verifyEmail('nope@normalB.test');
  t('real 550 -> invalid', r.status, 'invalid');

  scenario = (e, i) => (i === 0 ? { code: 250, message: 'OK', connected: true } : { code: 451, message: 'greylisted', connected: true });
  r = await verifyEmail('x@greyC.test');
  t('real 250 + probes greylisted 4xx -> unknown (not a false valid)', r.status, 'unknown');

  scenario = () => ({ code: 0, message: 'Connection timeout', connected: false });
  r = await verifyEmail('x@deadD.test');
  t('no SMTP reply -> unknown', r.status, 'unknown');

  scenario = (e, i) => (i === 0 ? { code: 452, message: '4.2.2 mailbox is full', connected: true } : { code: 250, connected: true, message: '' });
  r = await verifyEmail('full@quotaE.test');
  t('real 452 over-quota -> inbox_full', r.status, 'inbox_full');

  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail ? 1 : 0);
})();

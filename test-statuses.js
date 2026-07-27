// Verification test for the Reoon-style fine-grained statuses.
// Run: node test-statuses.js
// Exercises the status taxonomy, the SMTP-reply classifier, and the live
// syntax/disposable/spamtrap/role/safe paths (DNS-only, so it works even when
// outbound port 25 is blocked).

process.env.SPAMTRAP_DOMAINS = 'trap.example.test';   // must be set BEFORE requiring verifier

const { verifyEmail, quickVerify, statusBucket, isRoleAddress, classifySmtpMessage, STATUSES } = require('./verifier');
const { fetchDomains } = require('./disposable');

let passed = 0, failed = 0;
const ok = (name, cond, extra = '') => {
    if (cond) { passed++; console.log(`  ✓ ${name}`); }
    else { failed++; console.log(`  ✗ ${name} ${extra}`); }
};

(async () => {
    console.log('\n1) Status taxonomy (9 statuses):', STATUSES.join(', '));
    ok('9 statuses defined', STATUSES.length === 9);

    console.log('\n2) statusBucket() rollup mapping');
    const bucketExpect = {
        safe: 'valid', role: 'valid',
        invalid: 'invalid', disabled: 'invalid', disposable: 'invalid',
        'catch-all': 'catchAll',
        inbox_full: 'unknown', spamtrap: 'unknown', unknown: 'unknown',
    };
    for (const [st, want] of Object.entries(bucketExpect)) {
        ok(`${st} -> ${want}`, statusBucket(st) === want, `(got ${statusBucket(st)})`);
    }

    console.log('\n3) isRoleAddress()');
    ok('support@x.com is role', isRoleAddress('support@x.com') === true);
    ok('info+tag@x.com is role', isRoleAddress('info+tag@x.com') === true);
    ok('john.doe@x.com is NOT role', isRoleAddress('john.doe@x.com') === false);

    console.log('\n4) classifySmtpMessage() SMTP-reply parsing');
    ok('over quota -> inbox_full', classifySmtpMessage('552 5.2.2 The email account that you tried to reach is over quota') === 'inbox_full');
    ok('mailbox full -> inbox_full', classifySmtpMessage('452 4.2.2 mailbox is full') === 'inbox_full');
    ok('disabled -> disabled', classifySmtpMessage('550 5.2.1 The account is disabled') === 'disabled');
    ok('suspended -> disabled', classifySmtpMessage('550 account suspended') === 'disabled');
    ok('spamtrap -> spamtrap', classifySmtpMessage('550 5.7.1 spamtrap hit') === 'spamtrap');
    ok('no such user -> null', classifySmtpMessage('550 5.1.1 No such user here') === null);

    console.log('\n5) verifyEmail() – syntax / disposable / spamtrap / no-MX (no port 25 needed)');
    await fetchDomains().catch(() => {});   // load disposable list (best-effort)

    const bad = await verifyEmail('not-an-email');
    ok('bad syntax -> invalid', bad.status === 'invalid', `(got ${bad.status})`);

    const trap = await verifyEmail('anyone@trap.example.test');
    ok('SPAMTRAP_DOMAINS -> spamtrap', trap.status === 'spamtrap', `(got ${trap.status})`);

    const noMx = await verifyEmail('user@nonexistent-domain-zzqq12345.test');
    ok('no MX -> invalid', noMx.status === 'invalid', `(got ${noMx.status})`);

    const disp = await verifyEmail('someone@mailinator.com');
    ok('disposable -> disposable (or unknown if list unfetched)',
        disp.status === 'disposable' || disp.status === 'unknown',
        `(got ${disp.status})`);
    console.log(`      mailinator.com => ${disp.status} (${disp.reason})`);

    console.log('\n6) quickVerify() – safe vs role split (DNS-only, real domain)');
    const q1 = await quickVerify('support@gmail.com');
    ok('support@gmail.com -> role', q1.status === 'role', `(got ${q1.status})`);
    const q2 = await quickVerify('somerandomperson@gmail.com');
    ok('personal@gmail.com -> safe', q2.status === 'safe', `(got ${q2.status})`);

    console.log('\n7) Live full verification samples (may be "unknown" if port 25 is blocked)');
    for (const addr of ['jeff@amazon.com', 'someone-that-cannot-exist-9988@gmail.com']) {
        const r = await verifyEmail(addr);
        console.log(`   ${addr.padEnd(45)} -> ${String(r.status).padEnd(11)} conf=${r.confidence}  ${r.reason}`);
    }

    console.log(`\n=== ${passed} passed, ${failed} failed ===`);
    process.exit(failed ? 1 : 0);
})();

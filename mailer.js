// Email sending for password resets, via nodemailer + SMTP.
//
// Self-enables when SMTP_HOST is set (with SMTP_USER/SMTP_PASS for real
// providers). If it isn't configured, sendResetEmail() returns false and the
// caller logs the reset link to the console instead (handy in development).
let transporter = null;
let enabled = false;

try {
    const nodemailer = require('nodemailer');
    const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;

    if (SMTP_HOST) {
        const port = Number(SMTP_PORT || 587);
        const opts = {
            host: SMTP_HOST,
            port,
            secure: port === 465, // SSL for 465; STARTTLS for 587 and others
        };
        if (SMTP_USER && SMTP_PASS) opts.auth = { user: SMTP_USER, pass: SMTP_PASS };

        transporter = nodemailer.createTransport(opts);
        enabled = true;
        console.log(`[Mail] SMTP configured (${SMTP_HOST}:${port}) — password-reset emails enabled.`);
    } else {
        console.warn('[Mail] SMTP not configured — reset links will be logged to the console.');
    }
} catch (e) {
    console.warn('[Mail] nodemailer unavailable — reset links will be logged:', e.message);
}

const isEmailEnabled = () => enabled;

const FROM = process.env.SMTP_FROM || 'BounceCure <no-reply@bouncecure.app>';

function resetEmailHtml(link) {
    return `<!doctype html>
<html><body style="margin:0;background:#f6f5ff;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 12px;">
    <tr><td align="center">
      <table role="presentation" width="480" cellpadding="0" cellspacing="0"
             style="background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden;">
        <tr><td style="padding:28px 32px 8px;">
          <div style="font-size:20px;font-weight:800;color:#1a1a2e;">Bounce<span style="color:#4f46e5;">Cure</span></div>
        </td></tr>
        <tr><td style="padding:8px 32px 0;">
          <h1 style="font-size:20px;color:#0f172a;margin:0 0 12px;">Reset your password</h1>
          <p style="font-size:14px;color:#475569;line-height:1.6;margin:0 0 24px;">
            We received a request to reset your BounceCure password. Click the button below to choose a new one.
            This link expires in <strong>1 hour</strong>.
          </p>
          <a href="${link}" style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;
             font-weight:600;font-size:15px;padding:12px 24px;border-radius:10px;">Reset password</a>
          <p style="font-size:12px;color:#94a3b8;line-height:1.6;margin:24px 0 0;">
            If the button doesn't work, copy this link into your browser:<br>
            <a href="${link}" style="color:#4f46e5;word-break:break-all;">${link}</a>
          </p>
          <p style="font-size:12px;color:#94a3b8;line-height:1.6;margin:16px 0 8px;">
            Didn't request this? You can safely ignore this email — your password won't change.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

// Sends the reset email. Returns true if sent, false if email isn't configured.
// Throws only on an actual send failure (the caller decides how to handle it).
async function sendResetEmail(to, link) {
    if (!enabled) return false;
    const text = `Reset your BounceCure password:\n${link}\n\nThis link expires in 1 hour. If you didn't request it, ignore this email.`;
    await transporter.sendMail({
        from: FROM,
        to,
        subject: 'Reset your BounceCure password',
        text,
        html: resetEmailHtml(link),
    });
    return true;
}

module.exports = { isEmailEnabled, sendResetEmail };

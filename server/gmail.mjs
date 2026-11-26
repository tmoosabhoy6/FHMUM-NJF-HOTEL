/**
 * Sends one email through the Gmail API as the account that authorised the
 * app (scope gmail.send only: it cannot read the mailbox).
 *
 * Settings (Worker secrets, or .env for npm run dev):
 *   GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET   the Google OAuth client
 *   GMAIL_REFRESH_TOKEN                    from `npm run gmail:setup`
 *   ALERT_EMAIL_TO                         who gets the alerts (comma-separated)
 */

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';

export const emailConfigured = (env) =>
  Boolean(env?.GMAIL_CLIENT_ID && env?.GMAIL_CLIENT_SECRET && env?.GMAIL_REFRESH_TOKEN && recipients(env).length);

export const recipients = (env) =>
  String(env?.ALERT_EMAIL_TO ?? '').split(/[,;\s]+/).map((a) => a.trim()).filter((a) => /^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$/.test(a));

function base64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
const base64url = (text) => base64(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const wrap = (b64) => b64.replace(/.{1,76}/g, '$&\r\n');
// RFC 2047, so a "→" or an em dash in the subject survives.
const header = (text) => (/^[\x20-\x7e]*$/.test(text) ? text : `=?UTF-8?B?${base64(text)}?=`);

/** The raw RFC 2822 message, text and HTML parts. */
export function mimeMessage({ to, subject, text, html }) {
  const boundary = `fh-${Math.random().toString(36).slice(2)}`;
  return [
    `To: ${to.join(', ')}`,
    `Subject: ${header(subject.replace(/[\r\n]+/g, ' '))}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    wrap(base64(text)),
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    wrap(base64(html)),
    `--${boundary}--`,
    '',
  ].join('\r\n');
}

export class GmailError extends Error {}

async function accessToken(env, fetchImpl) {
  const res = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GMAIL_CLIENT_ID,
      client_secret: env.GMAIL_CLIENT_SECRET,
      refresh_token: env.GMAIL_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    throw new GmailError(body.error === 'invalid_grant'
      ? 'Gmail sign-in expired or was revoked. Run npm run gmail:setup again.'
      : `Gmail sign-in failed (${body.error ?? res.status}).`);
  }
  return body.access_token;
}

/** Sends `{ subject, text, html }` to ALERT_EMAIL_TO. */
export async function sendGmail(env, message, fetchImpl = fetch) {
  const to = recipients(env);
  if (!emailConfigured(env)) throw new GmailError('Email alerts are not set up.');
  const token = await accessToken(env, fetchImpl);
  const res = await fetchImpl(SEND_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw: base64url(mimeMessage({ to, ...message })) }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new GmailError(`Gmail did not send the alert (${body.error?.message ?? res.status}).`);
  }
  return res.json();
}

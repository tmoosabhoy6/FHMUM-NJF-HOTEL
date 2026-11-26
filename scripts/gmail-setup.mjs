/**
 * One-time Gmail set-up for tour change alerts:  npm run gmail:setup
 *
 *   1. Asks for the Google OAuth client (type "Desktop app") ID and secret.
 *   2. Opens Google's consent page; you allow "Send email on your behalf"
 *      (gmail.send only: the app cannot read your mail).
 *   3. Sends a test email, then saves the four secrets on the Cloudflare
 *      Worker with `wrangler secret bulk` (and, if you like, in .env).
 *
 * Nothing is printed or written to the repo except .env, which git ignores.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { sendGmail } from '../server/gmail.mjs';

const SCOPE = 'https://www.googleapis.com/auth/gmail.send';
const rl = createInterface({ input: stdin, output: stdout });
const ask = async (question, fallback = '') => (await rl.question(fallback ? `${question} [${fallback}]: ` : `${question}: `)).trim() || fallback;
const yes = async (question) => /^y/i.test(await ask(`${question} (y/n)`, 'y'));

console.log(`
Tour change alerts by Gmail
---------------------------
You need a Google OAuth client once (about 3 minutes):
  1. https://console.cloud.google.com/ → create or pick a project.
  2. APIs & Services → Library → "Gmail API" → Enable.
  3. APIs & Services → OAuth consent screen (Google Auth Platform): External,
     add your Gmail address as a test user, then PUBLISH the app ("In production").
     Unpublished ("Testing") apps get sign-ins that expire after 7 days.
  4. Clients (Credentials) → Create OAuth client → type "Desktop app".
`);

const clientId = await ask('OAuth client ID', process.env.GMAIL_CLIENT_ID);
const clientSecret = await ask('OAuth client secret', process.env.GMAIL_CLIENT_SECRET);
if (!clientId || !clientSecret) {
  console.error('Both the client ID and secret are needed.');
  process.exit(1);
}

const verifier = randomBytes(48).toString('base64url');
const state = randomBytes(16).toString('hex');
const { code, redirectUri } = await new Promise((resolve, reject) => {
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.searchParams.get('state') !== state) {
      res.writeHead(400).end('Unexpected request.');
      return;
    }
    const error = url.searchParams.get('error');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      .end(error ? `<p>Google said: ${error}. You can close this tab.</p>` : '<p>Done. You can close this tab and return to the terminal.</p>');
    server.close();
    if (error) reject(new Error(`Google said: ${error}`));
    else resolve({ code: url.searchParams.get('code'), redirectUri: `http://127.0.0.1:${server.address().port}` });
  });
  server.listen(0, '127.0.0.1', () => {
    const redirect = `http://127.0.0.1:${server.address().port}`;
    const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    auth.search = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirect,
      response_type: 'code',
      scope: SCOPE,
      access_type: 'offline',
      prompt: 'consent',
      state,
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
    }).toString();
    console.log(`\nOpen this link, sign in with the Gmail account that should send the alerts, and allow it:\n\n${auth}\n`);
    const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
    spawnSync(opener, [auth.toString()], { stdio: 'ignore' });
  });
});

const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code', code_verifier: verifier }),
});
const token = await tokenRes.json();
if (!token.refresh_token) {
  console.error(`Google did not return a refresh token (${token.error_description ?? token.error ?? tokenRes.status}).`);
  process.exit(1);
}
console.log('Signed in.');

const to = await ask('Send the alerts to (comma-separated)', process.env.ALERT_EMAIL_TO);
const secrets = { GMAIL_CLIENT_ID: clientId, GMAIL_CLIENT_SECRET: clientSecret, GMAIL_REFRESH_TOKEN: token.refresh_token, ALERT_EMAIL_TO: to };

await sendGmail(secrets, {
  subject: 'Tour 0000: hotel pax changed from 42 to 38 (test)',
  text: 'Test from the FH-MUM NJF Hotel Accommodation Planner. Tour change alerts will look like this.\n\nTour 0000 (Najaf 3 Dec–7 Dec)\n- Hotel pax changed from 42 to 38',
  html: '<p>Test from the FH-MUM NJF Hotel Accommodation Planner. Tour change alerts will look like this.</p><p><b>Tour 0000</b> (Najaf 3 Dec–7 Dec)</p><ul><li>Hotel pax changed from <s>42</s> to <b>38</b></li></ul>',
});
console.log(`Test email sent to ${to}.`);

if (await yes('Save these on the Cloudflare Worker now (needs `npx wrangler login`)?')) {
  const dir = mkdtempSync(join(tmpdir(), 'gmail-'));
  const file = join(dir, 'secrets.json');
  try {
    writeFileSync(file, JSON.stringify(secrets), { mode: 0o600 });
    execFileSync('npx', ['wrangler', 'secret', 'bulk', file], { stdio: 'inherit', shell: process.platform === 'win32' });
    console.log('Saved on the Worker. Alerts start with the next check (every 15 minutes).');
  } catch {
    console.log('Could not save with wrangler. Add the four secrets in Cloudflare: Workers & Pages → najaf-stays → Settings → Variables and Secrets.');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
if (await yes('Also add them to .env for npm run dev?')) {
  appendFileSync('.env', `\n${Object.entries(secrets).map(([k, v]) => `${k}=${v}`).join('\n')}\n`);
  console.log('Added to .env.');
}
rl.close();

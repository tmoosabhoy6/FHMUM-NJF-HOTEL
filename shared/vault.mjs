/**
 * Passphrase encryption for the NKERP snapshot published on GitHub Pages.
 *
 * The site is public, so the group list is stored encrypted: AES-256-GCM with
 * a key derived from the passphrase by PBKDF2-SHA256. The same code runs in
 * GitHub Actions (to lock) and in the browser (to unlock), using Web Crypto.
 */
const ITERATIONS = 600_000;
const encoder = new TextEncoder();

const toBase64 = (bytes) => {
  let text = '';
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text);
};
const fromBase64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

async function keyFor(passphrase, salt, iterations) {
  const material = await crypto.subtle.importKey('raw', encoder.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** Locks `value` (any JSON) with `passphrase`. `info` stays readable without it. */
export async function lock(value, passphrase, info = {}) {
  if (!passphrase) throw new Error('A passphrase is required');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await keyFor(passphrase, salt, ITERATIONS);
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(JSON.stringify(value))));
  return { v: 1, kdf: 'PBKDF2-SHA256', iterations: ITERATIONS, salt: toBase64(salt), iv: toBase64(iv), data: toBase64(data), info };
}

/** Unlocks a locked file. Throws `WrongPassphrase` when the passphrase does not match. */
export async function unlock(file, passphrase) {
  if (!file || file.v !== 1) throw new Error('Unknown data format');
  const key = await keyFor(passphrase, fromBase64(file.salt), file.iterations);
  let plain;
  try {
    plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(file.iv) }, key, fromBase64(file.data));
  } catch {
    const error = new Error('Wrong passphrase');
    error.name = 'WrongPassphrase';
    throw error;
  }
  return JSON.parse(new TextDecoder().decode(plain));
}

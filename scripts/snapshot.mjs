/**
 * Pulls NKERP and writes the encrypted snapshot the GitHub Pages site reads.
 * Run by .github/workflows/pages.yml with these repository secrets:
 *   NKERP_LOGIN_ID, NKERP_PASSWORD, DATA_PASSPHRASE
 *
 *   node scripts/snapshot.mjs dist/data.json
 */
import { writeFileSync } from 'node:fs';
import { sharedClient } from '../server/nkerp/client.mjs';
import { runSync } from '../server/nkerp/sync.mjs';
import { lock } from '../shared/vault.mjs';

const out = process.argv[2] ?? 'dist/data.json';
const passphrase = process.env.DATA_PASSPHRASE;
if (!passphrase) {
  console.error('DATA_PASSPHRASE is not set; nothing written.');
  process.exit(1);
}

// Today in Najaf (UTC+3). Groups already in Najaf today are included.
const today = new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);
const steps = [];
const result = await runSync({
  client: sharedClient(),
  from: process.env.SNAPSHOT_FROM || today,
  to: null,
  emit: (event, data) => event === 'step' && data.status === 'done' && steps.push(data.detail),
});
for (const line of steps) console.log(`· ${line}`);

const { meta, groups } = result;
const file = await lock(result, passphrase, { fetchedAt: meta.fetchedAt, from: meta.from, through: meta.through });
writeFileSync(out, JSON.stringify(file));
console.log(`Wrote ${groups.length} groups (${meta.from} to ${meta.through}) to ${out}, encrypted.`);

import { describe, expect, it } from 'vitest';
import { lock, unlock } from '../shared/vault.mjs';

describe('snapshot encryption', () => {
  it('round-trips with the right passphrase and keeps info readable', async () => {
    const file = await lock({ groups: [{ tourNo: '2152' }] }, 'correct horse battery', { fetchedAt: 'x' });
    expect(file.info).toEqual({ fetchedAt: 'x' });
    expect(JSON.stringify(file)).not.toContain('2152');
    await expect(unlock(file, 'correct horse battery')).resolves.toEqual({ groups: [{ tourNo: '2152' }] });
  });
  it('refuses the wrong passphrase', async () => {
    const file = await lock({ a: 1 }, 'right');
    await expect(unlock(file, 'wrong')).rejects.toMatchObject({ name: 'WrongPassphrase' });
  });
});

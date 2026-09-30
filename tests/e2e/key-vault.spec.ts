import { test, expect } from '@playwright/test';
import { PrivateKey } from '@bsv/sdk';
import { createMnemonic, deriveMasterKey } from '../../src/services/vault';
import { addressForPublicKey } from '../../src/services/licence';
import { seedVault, stubBackend } from './cockpit-stub';
import { signedRecordTxHex } from '../support/nftgate-fixtures';
import { shot } from './shot';

test.use({ serviceWorkers: 'block' });

test('the key vault screen loads at ?screen=key', async ({ page }) => {
  await page.goto('/?screen=key');
  await expect(page.getByRole('heading', { name: 'The key vault' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Generate a new key' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Restore from a phrase' })).toBeVisible();
  await shot(page, 'key-vault');
});

const WOC = 'https://api.whatsonchain.com/v1/bsv/test';

// mw-yjxcw.4: a cockpit key's Key screen, unlocked, against a stubbed backend (/api/me
// naming collections, /api/utxos) and a stubbed WhatsOnChain (the issued licences are read
// from the key's own address history).
test('the key screen shows my QR, the Issue a licence form, and the licences I issued', async ({ page }) => {
  const mnemonic = createMnemonic();
  const governorKeyBytes = await deriveMasterKey(mnemonic);
  const governor = PrivateKey.fromHex(Buffer.from(governorKeyBytes).toString('hex'));
  await stubBackend(page, governor, undefined, {
    collections: [{ name: 'postern' }, { name: 'cairn', app: 'Cairn' }],
    utxoSatoshis: 25_000,
  });

  const holderAddress = (seed: string) => addressForPublicKey(PrivateKey.fromHex(seed.repeat(32)).toPublicKey().toString());
  const heldTxid = '1'.repeat(64);
  const revokedTxid = '2'.repeat(64);
  const revokeTxid = '3'.repeat(64);
  const revokedOrigin = `${revokedTxid}:0`;
  const txHex: Record<string, string> = {
    [heldTxid]: await signedRecordTxHex(governor, 'M', { collection: 'cairn', holder: holderAddress('22') }, 0),
    [revokedTxid]: await signedRecordTxHex(governor, 'M', { collection: 'postern', holder: holderAddress('33') }, 1),
    [revokeTxid]: await signedRecordTxHex(governor, 'W', { kind: 'revoke', origin: revokedOrigin }, 2),
  };
  const governorAddress = addressForPublicKey(governor.toPublicKey().toString());
  await page.route(`${WOC}/address/${governorAddress}/history`, (route) =>
    route.fulfill({ json: [{ tx_hash: revokedTxid, height: 90 }, { tx_hash: heldTxid, height: 100 }, { tx_hash: revokeTxid, height: 101 }] }),
  );
  await page.route(`${WOC}/address/${governorAddress}/unconfirmed/history`, (route) => route.fulfill({ json: { result: [] } }));
  await page.route(`${WOC}/tx/*/hex`, (route) => {
    const txid = route.request().url().split('/').slice(-2)[0];
    return route.fulfill({ status: txHex[txid] ? 200 : 404, contentType: 'text/plain', body: txHex[txid] ?? 'not found' });
  });
  await seedVault(page, mnemonic);

  await page.goto('/');
  await page.getByLabel('Recovery phrase').fill(mnemonic);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('heading', { name: 'Needs you' })).toBeVisible();

  await page.goto('/?v=key');
  await expect(page.getByRole('img', { name: 'QR code of my public key' })).toBeVisible();
  await expect(page.getByTestId('public-key-hex')).toHaveText(governor.toPublicKey().toString());

  const issue = page.getByRole('region', { name: 'Issue a licence' });
  await expect(issue).toBeVisible();
  await expect(issue.getByLabel('Collection').locator('option')).toHaveText(['postern', 'cairn (Cairn)']);
  await expect(page.getByTestId('issue-cost')).toContainText('Balance: 25,000 sats');
  await issue.scrollIntoViewIfNeeded();
  await shot(page, 'key-issue');

  await expect(page.getByTestId('issued-row')).toHaveCount(2);
  await expect(page.getByTestId('issued-row').filter({ hasText: 'held' })).toHaveCount(1);
  await expect(page.getByTestId('issued-row').filter({ hasText: 'revoked' })).toHaveCount(1);
  await page.getByRole('region', { name: 'Issued licences' }).scrollIntoViewIfNeeded();
  await shot(page, 'key-issued');
});

// tests/e2e/up-next.spec.ts — mw-njb33n.7: the Map's 'Up next' lists each story once: the stories any host may
// run under 'Any host', a silent host's pinned story with the words that it waits for that host.
// Shot: up-next-open.png.
import { test, expect } from '@playwright/test';
import { PrivateKey } from '@bsv/sdk';
import { createMnemonic, deriveMasterKey } from '../../src/services/vault';
import { seedVault, stubBackend } from './cockpit-stub';
import { shot, sized } from './shot';
import { fixtureView } from '../support/cockpit-fixture';

test.use({ serviceWorkers: 'block', viewport: sized({ width: 390, height: 844 }) });

test('Up next: four hosts list the same stories, the chip says 4 and each shows once', async ({ page }) => {
  const mnemonic = createMnemonic();
  const governorKeyBytes = await deriveMasterKey(mnemonic);
  const governor = PrivateKey.fromHex(Buffer.from(governorKeyBytes).toString('hex'));
  const view = fixtureView();
  const fresh = new Date(Date.now() - 60_000).toISOString();
  const silent = new Date(Date.now() - 30 * 3600_000).toISOString();
  const template = view.beads[0];
  const auto = [
    { id: 'mw-fnvjof.17.161', title: 'Auto story one' },
    { id: 'mw-fnvjof.17.177', title: 'Auto story two' },
    { id: 'mw-ar5k42b.8', title: 'Auto story three' },
  ];
  const pinned = { id: 'mw-qtu3zvz.148', title: 'Pinned to the desktop' };
  view.hosts = ['cloud1', 'cloud2', 'laptop', 'desktop'].map((name) => ({
    name,
    last_sync: name === 'desktop' ? silent : fresh,
    up_next: name === 'desktop' ? [...auto.slice(0, 2), pinned] : auto,
  }));
  view.beads = [
    ...view.beads,
    ...auto.map((a) => ({ ...template, ...a, parent: undefined, path: { ...template.path!, host: 'auto' } })),
    { ...template, ...pinned, parent: undefined, path: { ...template.path!, host: 'desktop' } },
  ];
  await stubBackend(page, governor, undefined, { view });
  await seedVault(page, mnemonic);

  await page.goto('/');
  await page.getByLabel('Recovery phrase').fill(mnemonic);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('button', { name: 'Unlock' })).toHaveCount(0);
  await page.goto('/?v=map');

  const chip = page.getByRole('button', { name: 'Up next: 4' });
  await expect(chip).toBeVisible();
  await chip.click();
  const region = page.getByRole('region', { name: 'Up next' });
  await expect(region.getByRole('link')).toHaveCount(4);
  await expect(region.getByText('Any host')).toBeVisible();
  await expect(region.getByText('waits for desktop')).toBeVisible();
  await shot(page, 'up-next-open');
});

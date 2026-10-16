// tests/e2e/map-icebox.spec.ts — mw-njb33n.1: an epic folds its iced stories into one
// closed 'Icebox (2)' row, shown here at a phone's width; a tap opens it.
// Shots: map-icebox.png (closed), map-icebox-open.png (opened).
import { test, expect } from '@playwright/test';
import { PrivateKey } from '@bsv/sdk';
import { createMnemonic, deriveMasterKey } from '../../src/services/vault';
import { seedVault, stubBackend } from './cockpit-stub';
import { shot, sized } from './shot';
import { fixtureView } from '../support/cockpit-fixture';
import type { ViewBead } from '../../src/model/view';

test.use({ serviceWorkers: 'block', viewport: sized({ width: 390, height: 844 }) });

const at = new Date(Date.now() - 20 * 60_000).toISOString();
const template = fixtureView().beads[0];
const story = (id: string, extra: Partial<ViewBead>): ViewBead => ({ ...template, id, type: 'task', status: 'open', parent: 'mw-ice', labels: [], waits: [], done_earlier: 0, closed: '', updated: at, ...extra });

const BEADS: ViewBead[] = [
  story('mw-ice', { title: 'Triage: the Icebox epic', type: 'epic', parent: undefined }),
  story('mw-ice.1', { title: 'Story still live' }),
  story('mw-ice.2', { title: 'Iced: rework the logo', status: 'deferred', priority: 4, labels: ['icebox'] }),
  story('mw-ice.3', { title: 'Iced: a second theme', status: 'deferred', priority: 4, labels: ['icebox'] }),
];

test('an epic folds two iced stories into one closed Icebox (2) row that opens on a tap', async ({ page }) => {
  const mnemonic = createMnemonic();
  const governorKeyBytes = await deriveMasterKey(mnemonic);
  const governor = PrivateKey.fromHex(Buffer.from(governorKeyBytes).toString('hex'));
  await stubBackend(page, governor, undefined, { beads: BEADS });
  await seedVault(page, mnemonic);

  await page.goto('/');
  await page.getByLabel('Recovery phrase').fill(mnemonic);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('button', { name: 'Unlock' })).toHaveCount(0);
  await page.goto('/?v=map&focus=mw-ice&lens=board');

  const row = page.getByRole('button', { name: 'Icebox (2)' });
  await expect(row).toBeVisible();
  await expect(row).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByText('Story still live')).toBeVisible();
  await expect(page.getByText('Iced: rework the logo')).toHaveCount(0);
  const box = await row.boundingBox();
  expect(box && box.x + box.width <= (page.viewportSize()?.width ?? 0)).toBe(true);
  await shot(page, 'map-icebox');

  await row.click();
  await expect(page.getByRole('region', { name: 'Icebox' }).getByText('Iced: rework the logo')).toBeVisible();
  await expect(page.getByText('Iced: a second theme')).toBeVisible();
  await shot(page, 'map-icebox-open');
});

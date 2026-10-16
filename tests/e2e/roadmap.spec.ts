// tests/e2e/roadmap.spec.ts — mw-njb33n.3: the Roadmap's four lanes from a fixture view at a phone's width,
// a tap opening an app to its titles, a title opening its bead.
// Shots: roadmap.png (closed rows), roadmap-open.png (an app opened).
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
// A rig of its own, so the fixture's other beads do not change these rows.
const RIG = 'roadapp';
const story = (id: string, extra: Partial<ViewBead>): ViewBead => ({
  ...template,
  id,
  type: 'task',
  status: 'open',
  parent: undefined,
  labels: [],
  waits: [],
  done_earlier: 0,
  closed: '',
  updated: at,
  path: { rig: RIG, branch: 'main', host: 'laptop', model: 'sonnet', effort: 'high', formula: 'tdd-feature', harness: 'claude' },
  ...extra,
});

const BEADS: ViewBead[] = [
  story('rd.1', { title: 'Roadmap: the urgent one', priority: 0 }),
  story('rd.2', { title: 'Roadmap: the second now', priority: 1 }),
  story('rd.3', { title: 'Roadmap: a next thing', priority: 2 }),
  story('rd.4', { title: 'Roadmap: a later thing', priority: 3 }),
  story('rd.5', { title: 'Roadmap: an iced thing', priority: 4, status: 'deferred', labels: ['icebox'] }),
  story('rd.6', { title: 'Roadmap: an iced P1', priority: 1, labels: ['icebox'] }),
];

test('the Roadmap draws four lanes with counts per app; a tap opens an app and a title opens its bead', async ({ page }) => {
  const mnemonic = createMnemonic();
  const governorKeyBytes = await deriveMasterKey(mnemonic);
  const governor = PrivateKey.fromHex(Buffer.from(governorKeyBytes).toString('hex'));
  await stubBackend(page, governor, undefined, { beads: BEADS });
  await seedVault(page, mnemonic);

  await page.goto('/');
  await page.getByLabel('Recovery phrase').fill(mnemonic);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('button', { name: 'Unlock' })).toHaveCount(0);

  await page.goto('/?v=map');
  await page.getByRole('link', { name: 'Roadmap', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Roadmap', exact: true })).toBeVisible();

  const lane = (name: string) => page.getByRole('region', { name, exact: true });
  for (const name of ['Now', 'Next', 'Later', 'Icebox']) await expect(lane(name)).toBeVisible();

  // The fixture's own beads sit in rigs of their own; this rig's rows hold exactly these counts.
  const now = lane('Now').getByRole('button', { name: `${RIG}, 2` });
  await expect(now).toBeVisible();
  await expect(now).toContainText('Roadmap: the urgent one');
  await expect(now).toHaveAttribute('aria-expanded', 'false');
  await expect(lane('Next').getByRole('button', { name: `${RIG}, 1` })).toContainText('Roadmap: a next thing');
  await expect(lane('Later').getByRole('button', { name: `${RIG}, 1` })).toContainText('Roadmap: a later thing');
  await expect(lane('Icebox').getByRole('button', { name: `${RIG}, 2` })).toContainText('Roadmap: an iced P1');

  const box = await now.boundingBox();
  expect(box && box.x >= 0 && box.x + box.width <= (page.viewportSize()?.width ?? 0)).toBe(true);
  await expect(page.getByText('Roadmap: the second now')).toHaveCount(0);
  await shot(page, 'roadmap');

  await now.click();
  await expect(now).toHaveAttribute('aria-expanded', 'true');
  await expect(lane('Now').getByRole('link', { name: /Roadmap: the second now/ })).toBeVisible();
  await shot(page, 'roadmap-open');

  await lane('Now').getByRole('link', { name: /Roadmap: the second now/ }).click();
  await expect(page).toHaveURL(/v=bead&id=rd\.2/);
});

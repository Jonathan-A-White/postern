// tests/e2e/open-lists.spec.ts — mw-f758y.30: the 'Grillings · N' and 'Open maps · N'
// chips in a real browser: two open grillings (one with a decision card) and a
// closed one; the chip counts the two, lists them, and the card opens on a tap.
// Shots: open-grillings.png, open-maps.png.
import { test, expect } from '@playwright/test';
import { PrivateKey } from '@bsv/sdk';
import { createMnemonic, deriveMasterKey } from '../../src/services/vault';
import { seedVault, stubBackend } from './cockpit-stub';
import { shot } from './shot';
import { fixtureView } from '../support/cockpit-fixture';
import type { Need, ViewBead } from '../../src/model/view';

test.use({ serviceWorkers: 'block' });

const at = new Date(Date.now() - 20 * 60_000).toISOString();
const template = fixtureView().beads[0];
const grilling = (id: string, extra: Partial<ViewBead>): ViewBead => ({ ...template, id, type: 'task', status: 'open', parent: undefined, labels: [], waits: [], done_earlier: 0, closed: '', updated: at, ...extra });

const BEADS: ViewBead[] = [
  grilling('mw-gr.1', { title: 'Grilling: where the sats rest', labels: ['wayfinder:map'] }),
  grilling('mw-gr.2', { title: 'Grilling: what to call the chips' }),
  grilling('mw-gr.3', { title: 'Grilling: already settled', status: 'closed', closed: at }),
];
const NEEDS: Need[] = [
  {
    kind: 'question',
    bead: 'mw-gr.1',
    epic: 'mw-gr.1',
    title: 'Grilling: where the sats rest',
    since: at,
    text: 'Which wallet holds the testnet sats?\n\n- **The phone** — his key stays there.\n- **The VPS** — easier to top up.',
    recommended: 'The phone',
    options: ['The phone', 'The VPS'],
    blocks: 0,
    steps: [],
  },
];

test('Grillings · 2 lists the open grillings and opens the card; Open maps lists the open maps', async ({ page }) => {
  const mnemonic = createMnemonic();
  const governorKeyBytes = await deriveMasterKey(mnemonic);
  const governor = PrivateKey.fromHex(Buffer.from(governorKeyBytes).toString('hex'));
  await stubBackend(page, governor, undefined, { needs: NEEDS, beads: BEADS });
  await seedVault(page, mnemonic);

  await page.goto('/');
  await page.getByLabel('Recovery phrase').fill(mnemonic);
  await page.getByRole('button', { name: 'Unlock' }).click();

  const chip = page.getByRole('button', { name: 'Grillings · 2' });
  await expect(chip).toBeVisible();
  await chip.click();
  const list = page.getByRole('region', { name: 'Open grillings' });
  await expect(list.getByText('Grilling: where the sats rest')).toBeVisible();
  await expect(list.getByText('Grilling: what to call the chips')).toBeVisible();
  await expect(list.getByText('Grilling: already settled')).toHaveCount(0);
  const question = list.getByRole('button', { name: 'Which wallet holds the testnet sats?' });
  await expect(question).toBeVisible();
  await question.click();
  await expect(list.getByTestId('need-card')).toContainText('The VPS');
  await shot(page, 'open-grillings');

  await page.goto('/?v=map');
  await page.getByRole('button', { name: /^Open maps · \d+$/ }).click();
  const maps = page.getByRole('region', { name: 'Open maps' });
  await expect(maps.getByText('The BSV library, built to its spec')).toBeVisible();
  await expect(maps.getByText('Grilling: where the sats rest')).toHaveCount(0);
  await shot(page, 'open-maps');
});

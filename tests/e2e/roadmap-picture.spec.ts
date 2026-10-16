// tests/e2e/roadmap-picture.spec.ts — mw-njb33n.6: the Roadmap's Picture from a fixture view at a phone's
// width: the Picture toggle draws a canvas, a tap on an epic's node opens its bead, and with WebGL taken
// away the lanes show instead.
// Shots: roadmap-picture.png.
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
const RIG = 'picapp';
const bead = (id: string, extra: Partial<ViewBead>): ViewBead => ({
  ...template,
  id,
  type: 'task',
  status: 'open',
  priority: 2,
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
  bead('pe.1', { title: 'Picture: the big epic', type: 'epic' }),
  bead('pe.1.1', { title: 'Picture: story one', parent: 'pe.1', priority: 0 }),
  bead('pe.1.2', { title: 'Picture: story two', parent: 'pe.1', priority: 1 }),
  bead('pe.1.3', { title: 'Picture: story three', parent: 'pe.1', priority: 2 }),
  bead('pe.2', { title: 'Picture: the small epic', type: 'epic' }),
  bead('pe.2.1', { title: 'Picture: story four', parent: 'pe.2', priority: 3 }),
];

async function open(page: import('@playwright/test').Page) {
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
}

test('the Picture draws a canvas and a tap on an epic node opens its bead', async ({ page }) => {
  await open(page);
  await expect(page.getByTestId('roadmap')).toBeVisible();
  await page.getByRole('tab', { name: 'Picture' }).click();

  const canvas = page.getByRole('img', { name: /The roadmap as a picture/ });
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  if (!box) throw new Error('the canvas has no box');
  expect(box.x >= 0 && box.x + box.width <= (page.viewportSize()?.width ?? 0)).toBe(true);
  // It drew: the backing store is sized to the box, and the big epic's count is laid over its node.
  await expect.poll(() => canvas.evaluate((c: HTMLCanvasElement) => c.width)).toBeGreaterThanOrEqual(Math.floor(box.width));
  await shot(page, 'roadmap-picture');

  // The big epic's node is where its count is laid: the labels follow the circles, and never take a tap.
  const label = await page.locator('[data-node="pe.1"]').boundingBox();
  if (!label) throw new Error('no node for pe.1');
  await canvas.click({ position: { x: label.x + label.width / 2 - box.x, y: label.y + label.height / 2 - box.y } });
  await expect(page).toHaveURL(/v=bead&id=pe\.1(&|$)/);
});

test('with WebGL taken away the lanes show and say so', async ({ page }) => {
  await page.addInitScript(() => {
    const real = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, kind: string, ...rest: unknown[]) {
      if (kind === 'webgl2' || kind === 'webgl' || kind === 'experimental-webgl') return null;
      return (real as (k: string, ...r: unknown[]) => unknown).call(this, kind, ...rest);
    } as typeof real;
  });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await open(page);
  await page.getByRole('tab', { name: 'Picture' }).click();
  await expect(page.getByRole('status')).toContainText('WebGL');
  await expect(page.getByTestId('roadmap')).toBeVisible();
  await expect(page.getByTestId('roadmap-picture')).toHaveCount(0);
  expect(errors).toEqual([]);
});

// features/steps/share-where.steps.tsx — runs features/share-where.feature: the
// Share screen's 'New channel' row and the 'Last used' thread (mw-dw0i6.2). The whole
// app (<App />) against a small stubbed backend serving tests/support/cockpit-fixture.ts.
import '@testing-library/react/dont-cleanup-after-each';
import { afterAll, expect, vi } from 'vitest';
import { cleanup, configure, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PrivateKey, Utils } from '@bsv/sdk';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { App } from '../../src/App';
import { db } from '../../src/data/db';
import { sharesRepo, vaultRepo } from '../../src/data/repositories';
import { lock, setKey } from '../../src/services/keySession';
import { stopLive } from '../../src/services/live';
import { sealDocument } from '../../src/services/documents';
import { MAYOR, fixtureRecords, fixtureView } from '../../tests/support/cockpit-fixture';

configure({ asyncUtilTimeout: 5000 });

const feature = await loadFeature('features/share-where.feature');

const HIM = PrivateKey.fromHex('5a'.repeat(32));
const HIM_KEY = new Uint8Array(Utils.toArray(HIM.toHex(), 'hex'));
const HIM_PUB = HIM.toPublicKey().toString();

afterAll(() => {
  cleanup();
  stopLive();
  lock();
  vi.unstubAllGlobals();
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

async function liveWithAScreenshot(): Promise<void> {
  cleanup();
  stopLive();
  lock();
  vi.unstubAllGlobals();
  await Promise.all([db.vault.clear(), db.settings.clear(), db.messages.clear(), db.view.clear(), db.beadDetails.clear(), db.answers.clear(), db.shares.clear(), db.session.clear()]);
  await vaultRepo.save({ mode: 'phrase', ciphertext: new ArrayBuffer(48), iv: new Uint8Array(12), salt: new Uint8Array(16), publicKeyHex: HIM_PUB });
  const now = Date.now();
  const view = await sealDocument(JSON.stringify(fixtureView(now)), MAYOR.toHex(), HIM_PUB);
  const records = fixtureRecords(HIM, now);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input), 'http://localhost').pathname;
      if (path.endsWith('/challenge')) return json({ nonce: crypto.randomUUID().replace(/-/g, '') });
      if (path.endsWith('/me')) return json({ pubkey: HIM_PUB, mayor: MAYOR.toPublicKey().toString(), network: 'testnet', features: ['direct', 'view', 'beads', 'me'] });
      if (path.endsWith('/view')) return new Response(view, { status: 200, headers: { ETag: '"fixture"' } });
      if (path.endsWith('/messages')) return json({ records, next: records.length });
      return new Response('not found', { status: 404 });
    }),
  );
  setKey(HIM_KEY);
  await park('s1');
}

async function park(id: string): Promise<void> {
  await sharesRepo.put({ id, createdAt: Date.now(), files: [{ name: 'screen.png', type: 'image/png', bytes: new Uint8Array([137, 80, 78, 71]).buffer }] });
}

async function openShare(id: string): Promise<void> {
  cleanup();
  window.history.pushState({}, '', `/?v=share&s=${id}`);
  render(<App />);
  await screen.findByRole('region', { name: 'Where to' });
}

function whereTo(): HTMLElement {
  return screen.getByRole('region', { name: 'Where to' });
}

async function startTopic(name: string): Promise<void> {
  await userEvent.click(within(whereTo()).getByRole('button', { name: /New channel/ }));
  await userEvent.type(screen.getByRole('textbox', { name: 'New channel' }), name);
  await userEvent.click(screen.getByRole('button', { name: 'Start' }));
}

async function expectComposerHoldsTheScreenshot(): Promise<void> {
  const composer = await screen.findByTestId('composer');
  expect(await within(composer).findByRole('button', { name: 'Remove screen.png' })).toBeInTheDocument();
}

async function sharedAgainAndOpened(): Promise<void> {
  await expectComposerHoldsTheScreenshot();
  await park('s2');
  await openShare('s2');
}

function rowTitles(): string[] {
  return within(whereTo())
    .getAllByRole('button')
    .map((row) => row.textContent ?? '');
}

describeFeature(feature, ({ Scenario }) => {
  Scenario('mw-dw0i6.2: New channel opens a named channel with the image in its composer', ({ Given, When, Then, And }) => {
    Given('the factory is live and a screenshot was shared into Postern', liveWithAScreenshot);
    When('the Share screen is opened and "New channel" is tapped and "Sprint notes" is typed and "Start" is tapped', async () => {
      await openShare('s1');
      await startTopic('Sprint notes');
    });
    Then('the channel "Sprint notes" opens with the screenshot in its composer', async () => {
      await expectComposerHoldsTheScreenshot();
      expect(window.location.search).toBe('?v=talk&t=topic%3ASprint+notes');
    });
    And('the parked share is gone', async () => {
      await waitFor(async () => expect(await sharesRepo.get('s1')).toBeUndefined());
      expect(await db.shares.count()).toBe(0);
    });
  });

  Scenario('mw-dw0i6.2: the channel shared to last is first and says Last used', ({ Given, When, Then, And }) => {
    Given('the factory is live and a screenshot was shared into Postern', liveWithAScreenshot);
    When('the screenshot is shared to the channel "desktop move"', async () => {
      await openShare('s1');
      await userEvent.click(await within(whereTo()).findByRole('button', { name: /^desktop move/ }));
    });
    And('a second screenshot is shared into Postern and the Share screen is opened', sharedAgainAndOpened);
    Then('the first row says "New channel" and the second is "desktop move" marked "Last used"', () => {
      const rows = rowTitles();
      expect(rows[0]).toContain('New channel');
      expect(rows[1]).toContain('desktop move');
      expect(rows[1]).toContain('Last used');
    });
    And('"desktop move" is listed once', () => {
      expect(rowTitles().filter((row) => row.includes('desktop move'))).toHaveLength(1);
    });
  });

  Scenario('mw-dw0i6.2: with no channel remembered the list is as before', ({ Given, When, Then, And }) => {
    Given('the factory is live and a screenshot was shared into Postern', liveWithAScreenshot);
    When('the Share screen is opened', () => openShare('s1'));
    Then('the first row says "New channel" and then comes "Factory"', () => {
      const rows = rowTitles();
      expect(rows[0]).toContain('New channel');
      expect(rows[1]).toContain('Factory');
    });
    And('"Last used" is nowhere on the screen', () => {
      expect(screen.queryByText('Last used')).toBeNull();
    });
  });

  Scenario('mw-dw0i6.2: a remembered channel with no message yet is still offered', ({ Given, When, Then, And }) => {
    Given('the factory is live and a screenshot was shared into Postern', liveWithAScreenshot);
    When('the screenshot is shared to the new channel "Fresh idea"', async () => {
      await openShare('s1');
      await startTopic('Fresh idea');
    });
    And('a second screenshot is shared into Postern and the Share screen is opened', sharedAgainAndOpened);
    Then('the first row says "New channel" and the second is "Fresh idea" marked "Last used"', () => {
      const rows = rowTitles();
      expect(rows[0]).toContain('New channel');
      expect(rows[1]).toContain('Fresh idea');
      expect(rows[1]).toContain('Last used');
    });
    And('"Fresh idea" is listed once', () => {
      expect(rowTitles().filter((row) => row.includes('Fresh idea'))).toHaveLength(1);
    });
  });
});

// features/steps/key-issue.steps.tsx — runs features/key-issue.feature under vitest via
// @amiceli/vitest-cucumber: the Key screen's QR, Issue a licence, and Issued licences with
// Revoke (mw-yjxcw.4). The backend's /api/me and the issuer service (src/services/issue.ts,
// covered by issue-licence.feature) are stood in for; the screen itself is the real one.
// See gate.steps.tsx for why dont-cleanup-after-each is imported and cleanup() called by hand.
import '@testing-library/react/dont-cleanup-after-each';
import { render, screen, cleanup, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { PrivateKey } from '@bsv/sdk';
import { KeyVault } from '../../src/key';
import { qrPathData } from '../../src/key/qr';
import { db } from '../../src/data/db';
import { vaultRepo } from '../../src/data/repositories';
import { lock, setKey } from '../../src/services/keySession';
import { addressForPublicKey } from '../../src/services/licence';
import { issueCost, type IssuedLicenceEntry } from '../../src/services/issue';
import type { Me } from '../../src/services/me';

const services = vi.hoisted(() => ({
  fetchMe: vi.fn(),
  issueLicence: vi.fn(),
  revokeLicence: vi.fn(),
  issuedLicences: vi.fn(),
  fetchIssuerBalance: vi.fn(),
}));

vi.mock('../../src/services/me', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/me')>()),
  fetchMe: services.fetchMe,
}));
vi.mock('../../src/services/issue', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/issue')>()),
  issueLicence: services.issueLicence,
  revokeLicence: services.revokeLicence,
  issuedLicences: services.issuedLicences,
  fetchIssuerBalance: services.fetchIssuerBalance,
}));

const feature = await loadFeature('features/key-issue.feature');

const ME = PrivateKey.fromHex('11'.repeat(32));
const MASTER = new Uint8Array(ME.toArray('be', 32));
const MY_PUBLIC_KEY = ME.toPublicKey().toString();
const HOLDER_PUBLIC_KEY = PrivateKey.fromHex('22'.repeat(32)).toPublicKey().toString();
const HOLDER_ADDRESS = addressForPublicKey(HOLDER_PUBLIC_KEY);
const OTHER_ADDRESS = addressForPublicKey(PrivateKey.fromHex('33'.repeat(32)).toPublicKey().toString());
const HELD_TXID = 'a'.repeat(64);
const REVOKED_TXID = 'b'.repeat(64);
const ISSUED_TXID = 'c'.repeat(64);
const BALANCE = 50_000;

const meWith = (collections?: Array<{ name: string; app?: string }>): Me => ({
  pubkey: MY_PUBLIC_KEY,
  mayor: '',
  network: 'testnet',
  features: ['me'],
  ...(collections ? { collections } : {}),
});

const TWO_COLLECTIONS = [{ name: 'postern' }, { name: 'cairn', app: 'Cairn' }];

const HELD: IssuedLicenceEntry = {
  txid: HELD_TXID,
  origin: `${HELD_TXID}:0`,
  collection: 'cairn',
  holder: HOLDER_ADDRESS,
  height: 100,
  revoked: false,
};
const REVOKED: IssuedLicenceEntry = {
  txid: REVOKED_TXID,
  origin: `${REVOKED_TXID}:0`,
  collection: 'postern',
  holder: OTHER_ADDRESS,
  height: 90,
  revoked: true,
};

async function unlockedWith(collections?: Array<{ name: string; app?: string }>) {
  cleanup();
  vi.clearAllMocks();
  delete (window as { BarcodeDetector?: unknown }).BarcodeDetector;
  await db.vault.clear();
  await db.settings.clear();
  lock();
  await vaultRepo.save({ mode: 'phrase', ciphertext: new ArrayBuffer(1), iv: new Uint8Array(12), publicKeyHex: MY_PUBLIC_KEY });
  setKey(MASTER);
  services.fetchMe.mockResolvedValue(meWith(collections));
  services.fetchIssuerBalance.mockResolvedValue(BALANCE);
  services.issuedLicences.mockResolvedValue([]);
  services.issueLicence.mockResolvedValue({ txid: ISSUED_TXID, origin: `${ISSUED_TXID}:0`, collection: 'cairn', holder: HOLDER_ADDRESS });
  services.revokeLicence.mockResolvedValue({ txid: 'd'.repeat(64) });
}

function issueSection() {
  return screen.findByRole('region', { name: 'Issue a licence' });
}

async function openKeyScreen() {
  render(<KeyVault />);
  await screen.findByText('Key unlocked');
}

async function typeHolderAndChooseCairn() {
  const section = await issueSection();
  await userEvent.type(within(section).getByLabelText("Holder's public key"), HOLDER_PUBLIC_KEY);
  await userEvent.selectOptions(within(section).getByLabelText('Collection'), 'cairn');
}

function heldRow() {
  return screen.getAllByTestId('issued-row').find((row) => row.textContent?.includes('held'))!;
}

afterAll(() => {
  cleanup();
  delete (window as { BarcodeDetector?: unknown }).BarcodeDetector;
  lock();
});

describeFeature(feature, ({ Scenario }) => {
  Scenario("AC1: my public key is shown as a QR and as hex when the key is unlocked", ({ Given, When, Then, And }) => {
    Given('my key is unlocked and the backend names two collections', async () => {
      await unlockedWith(TWO_COLLECTIONS);
    });
    When('the key screen is opened', openKeyScreen);
    Then('I see a QR code that encodes my public key', async () => {
      const qr = await screen.findByRole('img', { name: 'QR code of my public key' });
      expect(qr.querySelector('path')?.getAttribute('d')).toBe(qrPathData(MY_PUBLIC_KEY));
    });
    And('I see my public key as hex', () => {
      expect(screen.getByTestId('public-key-hex')).toHaveTextContent(MY_PUBLIC_KEY);
    });
    And('I can copy it', () => {
      expect(screen.getByRole('button', { name: 'Copy public key' })).toBeEnabled();
    });
  });

  Scenario('AC2: Scan is absent when the phone has no BarcodeDetector', ({ Given, And, When, Then }) => {
    Given('my key is unlocked and the backend names two collections', async () => {
      await unlockedWith(TWO_COLLECTIONS);
    });
    And('this browser has no BarcodeDetector', () => {
      expect('BarcodeDetector' in window).toBe(false);
    });
    When('the key screen is opened', openKeyScreen);
    Then('there is no Scan button', async () => {
      await issueSection();
      expect(screen.queryByRole('button', { name: 'Scan' })).not.toBeInTheDocument();
    });
    And("I can still paste a holder's key into the field", async () => {
      const field = screen.getByLabelText("Holder's public key");
      await userEvent.click(field);
      await userEvent.paste(HOLDER_PUBLIC_KEY);
      expect(field).toHaveValue(HOLDER_PUBLIC_KEY);
    });
  });

  Scenario('AC3: Scan is present with a BarcodeDetector and fills the field with the code it reads', ({ Given, And, When, Then }) => {
    const stop = vi.fn();
    Given('my key is unlocked and the backend names two collections', async () => {
      await unlockedWith(TWO_COLLECTIONS);
    });
    And("this browser has a BarcodeDetector that reads a holder's key", () => {
      class FakeDetector {
        async detect() {
          return [{ rawValue: HOLDER_PUBLIC_KEY }];
        }
      }
      (window as unknown as { BarcodeDetector: unknown }).BarcodeDetector = FakeDetector;
      Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop }] })) },
      });
      vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    });
    When('the key screen is opened', openKeyScreen);
    And('I press Scan', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Scan' }));
    });
    Then('the holder field holds the key that was read', async () => {
      await waitFor(() => expect(screen.getByLabelText("Holder's public key")).toHaveValue(HOLDER_PUBLIC_KEY));
    });
    And('the camera is stopped', async () => {
      await waitFor(() => expect(stop).toHaveBeenCalled());
      expect(screen.queryByTestId('scan-video')).not.toBeInTheDocument();
    });
  });

  Scenario('AC4: the collection list comes from the backend', ({ Given, When, Then }) => {
    Given('my key is unlocked and the backend names two collections', async () => {
      await unlockedWith(TWO_COLLECTIONS);
    });
    When('the key screen is opened', openKeyScreen);
    Then('the collection choices are postern and cairn with its app name', async () => {
      const section = await issueSection();
      const options = within(within(section).getByLabelText('Collection')).getAllByRole('option');
      expect(options.map((o) => o.textContent)).toEqual(['postern', 'cairn (Cairn)']);
      expect(options.map((o) => (o as HTMLOptionElement).value)).toEqual(['postern', 'cairn']);
    });
  });

  Scenario('AC5: an app key, with no collections, sees no Issue section', ({ Given, When, Then }) => {
    Given('my key is unlocked and the backend names no collections', async () => {
      await unlockedWith(undefined);
    });
    When('the key screen is opened', openKeyScreen);
    Then('there is no Issue a licence section', async () => {
      await waitFor(() => expect(services.fetchMe).toHaveBeenCalled());
      expect(screen.queryByRole('region', { name: 'Issue a licence' })).not.toBeInTheDocument();
      expect(screen.queryByText('Issued licences')).not.toBeInTheDocument();
    });
  });

  Scenario('AC6: Issue calls issueLicence with the typed key and the chosen collection and shows the txid', ({ Given, And, When, Then }) => {
    Given('my key is unlocked and the backend names two collections', async () => {
      await unlockedWith(TWO_COLLECTIONS);
    });
    And('I hold enough sats to issue', () => {
      services.fetchIssuerBalance.mockResolvedValue(BALANCE);
    });
    When('the key screen is opened', openKeyScreen);
    And("I type a holder's key and choose cairn", async () => {
      const section = await issueSection();
      await userEvent.type(within(section).getByLabelText("Holder's public key"), HOLDER_PUBLIC_KEY);
      await userEvent.selectOptions(within(section).getByLabelText('Collection'), 'cairn');
    });
    And('I press Issue', async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Issue' }));
    });
    And('I confirm the issue', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Confirm issue' }));
    });
    Then('issueLicence was called with that key and cairn', async () => {
      await waitFor(() => expect(services.issueLicence).toHaveBeenCalledTimes(1));
      expect(services.issueLicence).toHaveBeenCalledWith(
        expect.objectContaining({ issuerKey: MASTER, holderPublicKeyHex: HOLDER_PUBLIC_KEY, collection: 'cairn' }),
      );
    });
    And('I see the txid of the mint as a testnet link', async () => {
      const link = await screen.findByRole('link', { name: ISSUED_TXID });
      expect(link).toHaveAttribute('href', `https://test.whatsonchain.com/tx/${ISSUED_TXID}`);
    });
    And('the cost is shown against my balance', () => {
      const cost = issueCost();
      const text = screen.getByTestId('issue-cost').textContent ?? '';
      expect(text).toContain(cost.fuelSatoshis.toLocaleString('en-US'));
      expect(text).toContain(cost.feeEstimateSatoshis.toLocaleString('en-US'));
      expect(text).toContain(BALANCE.toLocaleString('en-US'));
    });
  });

  Scenario('AC7: Revoke asks to confirm and then calls revokeLicence', ({ Given, And, When, Then }) => {
    Given('my key is unlocked and the backend names two collections', async () => {
      await unlockedWith(TWO_COLLECTIONS);
    });
    And('I issued a held licence and a revoked one', () => {
      services.issuedLicences.mockResolvedValue([HELD, REVOKED]);
    });
    When('the key screen is opened', openKeyScreen);
    And('I press Revoke on the held licence', async () => {
      await screen.findAllByTestId('issued-row');
      await userEvent.click(within(heldRow()).getByRole('button', { name: /^Revoke/ }));
    });
    Then('nothing is revoked yet and I am asked to confirm', () => {
      expect(services.revokeLicence).not.toHaveBeenCalled();
      expect(within(heldRow()).getByText('Revoke this licence?')).toBeInTheDocument();
    });
    When('I confirm the revoke', async () => {
      await userEvent.click(within(heldRow()).getByRole('button', { name: 'Confirm revoke' }));
    });
    Then("revokeLicence was called with that licence's origin", async () => {
      await waitFor(() => expect(services.revokeLicence).toHaveBeenCalledTimes(1));
      expect(services.revokeLicence).toHaveBeenCalledWith(expect.objectContaining({ issuerKey: MASTER, origin: HELD.origin }));
    });
  });

  Scenario('AC8: the row shows revoked afterwards', ({ Given, And, When, Then }) => {
    Given('my key is unlocked and the backend names two collections', async () => {
      await unlockedWith(TWO_COLLECTIONS);
    });
    And('I issued a held licence and a revoked one', () => {
      services.issuedLicences.mockResolvedValue([HELD, REVOKED]);
    });
    When('the key screen is opened', openKeyScreen);
    And('I press Revoke on the held licence', async () => {
      await screen.findAllByTestId('issued-row');
      await userEvent.click(within(heldRow()).getByRole('button', { name: /^Revoke/ }));
    });
    And('I confirm the revoke', async () => {
      await userEvent.click(within(heldRow()).getByRole('button', { name: 'Confirm revoke' }));
    });
    Then('both rows show revoked', async () => {
      await waitFor(() => {
        const rows = screen.getAllByTestId('issued-row');
        expect(rows).toHaveLength(2);
        for (const row of rows) expect(within(row).getByText('revoked')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /^Revoke/ })).not.toBeInTheDocument();
      });
    });
  });

  Scenario('AC9: issued licences are listed per collection with holder, date, txid link and status', ({ Given, And, When, Then }) => {
    Given('my key is unlocked and the backend names two collections', async () => {
      await unlockedWith(TWO_COLLECTIONS);
    });
    And('I issued a held licence and a revoked one', () => {
      services.issuedLicences.mockResolvedValue([HELD, REVOKED]);
    });
    When('the key screen is opened', openKeyScreen);
    Then('the licences are grouped under their collections', async () => {
      await screen.findAllByTestId('issued-row');
      const groups = screen.getAllByTestId('issued-group');
      expect(groups.map((g) => within(g).getByRole('heading', { level: 3 }).textContent)).toEqual(['cairn', 'postern']);
      expect(within(groups[0]).getAllByTestId('issued-row')).toHaveLength(1);
      expect(within(groups[1]).getAllByTestId('issued-row')).toHaveLength(1);
    });
    And('each row shows a shortened holder address, its date or block, a txid link to WhatsOnChain testnet and its status', () => {
      const row = heldRow();
      expect(within(row).getByTestId('issued-holder')).toHaveTextContent(`${HOLDER_ADDRESS.slice(0, 6)}…${HOLDER_ADDRESS.slice(-6)}`);
      expect(row).toHaveTextContent('Block 100');
      expect(within(row).getByRole('link')).toHaveAttribute('href', `https://test.whatsonchain.com/tx/${HELD_TXID}`);
      expect(within(row).getByText('held')).toBeInTheDocument();
      const revoked = screen.getAllByTestId('issued-row').find((r) => r !== row)!;
      expect(within(revoked).getByText('revoked')).toBeInTheDocument();
    });
    And('only the held row has a Revoke button', () => {
      expect(screen.getAllByRole('button', { name: /^Revoke/ })).toHaveLength(1);
      expect(within(heldRow()).getByRole('button', { name: /^Revoke/ })).toBeInTheDocument();
    });
  });

  Scenario('AC10: a failed /api/me says so, and Retry with a good answer shows the Issue section', ({ Given, And, When, Then }) => {
    Given('my key is unlocked and the backend fails to answer /api/me', async () => {
      await unlockedWith(TWO_COLLECTIONS);
      services.fetchMe.mockRejectedValue(new Error('the backend is unreachable'));
    });
    When('the key screen is opened', openKeyScreen);
    Then('I see that the collections could not be read and a Retry button', async () => {
      expect(await screen.findByText(/Could not read the collections\./)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled();
    });
    And('there is no Issue a licence section', () => {
      expect(screen.queryByRole('region', { name: 'Issue a licence' })).not.toBeInTheDocument();
    });
    When('the backend answers /api/me with two collections and I press Retry', async () => {
      services.fetchMe.mockResolvedValue(meWith(TWO_COLLECTIONS));
      await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    });
    Then('the Issue a licence section is shown', async () => {
      await issueSection();
    });
    And('the collections message is gone', () => {
      expect(screen.queryByText(/Could not read the collections\./)).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    });
  });

  Scenario('AC11: an app key with a good answer and no collections shows neither the section nor a message', ({ Given, When, Then, And }) => {
    Given('my key is unlocked and the backend names no collections', async () => {
      await unlockedWith(undefined);
    });
    When('the key screen is opened', openKeyScreen);
    Then('there is no Issue a licence section', async () => {
      await waitFor(() => expect(services.fetchMe).toHaveBeenCalled());
      expect(screen.queryByRole('region', { name: 'Issue a licence' })).not.toBeInTheDocument();
    });
    And('there is no collections message and no Retry button', () => {
      expect(screen.queryByText(/Could not read the collections/)).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    });
  });

  Scenario('AC12: Issue asks once before spending, and only Confirm issue calls issueLicence', ({ Given, And, When, Then }) => {
    Given('my key is unlocked and the backend names two collections', async () => {
      await unlockedWith(TWO_COLLECTIONS);
    });
    When('the key screen is opened', openKeyScreen);
    And("I type a holder's key and choose cairn", typeHolderAndChooseCairn);
    And('I press Issue', async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Issue' }));
    });
    Then('I am asked to issue to the shortened key in cairn for about the mint cost in sats', () => {
      const shortKey = `${HOLDER_PUBLIC_KEY.slice(0, 8)}…${HOLDER_PUBLIC_KEY.slice(-6)}`;
      const cost = issueCost().totalSatoshis.toLocaleString('en-US');
      expect(screen.getByText(`Issue a licence to ${shortKey} in cairn? Cost about ${cost} sats.`)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Confirm issue' })).toBeEnabled();
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled();
    });
    And('issueLicence has not been called', () => {
      expect(services.issueLicence).not.toHaveBeenCalled();
    });
    When('I confirm the issue', async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Confirm issue' }));
    });
    Then('issueLicence was called with that key and cairn', async () => {
      await waitFor(() => expect(services.issueLicence).toHaveBeenCalledTimes(1));
      expect(services.issueLicence).toHaveBeenCalledWith(
        expect.objectContaining({ issuerKey: MASTER, holderPublicKeyHex: HOLDER_PUBLIC_KEY, collection: 'cairn' }),
      );
    });
  });

  Scenario('AC13: Cancel on the Issue confirm calls nothing', ({ Given, And, When, Then }) => {
    Given('my key is unlocked and the backend names two collections', async () => {
      await unlockedWith(TWO_COLLECTIONS);
    });
    When('the key screen is opened', openKeyScreen);
    And("I type a holder's key and choose cairn", typeHolderAndChooseCairn);
    And('I press Issue', async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Issue' }));
    });
    And('I cancel the issue', async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    });
    Then('issueLicence has not been called', () => {
      expect(services.issueLicence).not.toHaveBeenCalled();
    });
    And('the confirm is gone and the Issue button is back', () => {
      expect(screen.queryByRole('button', { name: 'Confirm issue' })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Issue' })).toBeInTheDocument();
    });
  });
});

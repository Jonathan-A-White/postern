// features/steps/speech.steps.tsx — runs features/speech.feature under vitest via
// @amiceli/vitest-cucumber. jsdom implements no Web Speech API at all, so a fake
// speechSynthesis/SpeechSynthesisUtterance pair (installFakeSynthesis) stands in for
// it, the same fetch-stub approach features/steps/messages.steps.tsx uses for a
// missing browser API. The message scenarios render <Inbox /> the way
// messages.steps.tsx does; the question scenario renders <QuestionScreen /> directly,
// since the Play control there doesn't touch sending.
import '@testing-library/react/dont-cleanup-after-each';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { PrivateKey } from '@bsv/sdk';
import { Inbox } from '../../src/inbox';
import { QuestionScreen } from '../../src/projects';
import { db } from '../../src/data/db';
import { vaultRepo } from '../../src/data/repositories';
import {
  createMnemonic,
  deriveAesKeyFromPhrase,
  deriveMasterKey,
  publicKeyHexFromMasterKey,
  wrapKey,
} from '../../src/services/vault';
import { encryptMessage } from '../../src/services/messages';
import type { QuestionBody } from '../../src/services/questions';

const SENDER_KEY = PrivateKey.fromHex('44'.repeat(32));
const MESSAGE_TEXT = 'meet at the usual place';
const QUESTION: QuestionBody = {
  bead: 'mw-epic.1',
  q: 'Ship the walking skeleton now, or wait for WireGuard?',
  rec: 'ship',
  options: ['ship', 'wait'],
};

class FakeUtterance {
  text: string;
  voice: unknown = null;
  onend: (() => void) | null = null;
  constructor(text: string) {
    this.text = text;
  }
}

function installFakeSynthesis() {
  const speak = vi.fn();
  const cancel = vi.fn();
  vi.stubGlobal('speechSynthesis', { speak, cancel, getVoices: () => [] });
  vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);
  return { speak, cancel };
}

function spokenTextOf(speak: ReturnType<typeof vi.fn>, callIndex = 0): string {
  const utterance = speak.mock.calls[callIndex][0] as FakeUtterance;
  return utterance.text;
}

async function freshScreen(): Promise<void> {
  cleanup();
  await db.vault.clear();
  await db.settings.clear();
  await db.messages.clear();
  vi.unstubAllGlobals();
}

async function saveVaultForHim(): Promise<{ mnemonic: string; publicKeyHex: string }> {
  const mnemonic = createMnemonic();
  const key = await deriveMasterKey(mnemonic);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const aesKey = await deriveAesKeyFromPhrase(mnemonic, salt);
  const wrapped = await wrapKey(key, aesKey);
  const publicKeyHex = publicKeyHexFromMasterKey(key);
  await vaultRepo.save({
    mode: 'phrase',
    ciphertext: wrapped.ciphertext,
    iv: wrapped.iv,
    salt,
    prfFallbackReason: 'webauthn-unavailable',
    publicKeyHex,
  });
  return { mnemonic, publicKeyHex };
}

function messagesFetchMock(payload: unknown) {
  return vi.fn(async () =>
    new Response(JSON.stringify({ records: [{ seq: 1, txid: 'a'.repeat(64), vout: 0, payload }], next: 1 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

async function renderInboxWithOneMessage(): Promise<void> {
  const him = await saveVaultForHim();
  const payload = encryptMessage({
    text: MESSAGE_TEXT,
    class: 'message',
    senderPrivateKeyHex: SENDER_KEY.toHex(),
    recipientPublicKeyHex: him.publicKeyHex,
  });
  vi.stubGlobal('fetch', messagesFetchMock(payload));
  render(<Inbox />);
  await userEvent.type(await screen.findByLabelText('Recovery phrase'), him.mnemonic);
  await userEvent.click(screen.getByRole('button', { name: 'Unlock' }));
  await screen.findByText(MESSAGE_TEXT);
}

const feature = await loadFeature('features/speech.feature');

describeFeature(feature, ({ Scenario }) => {
  Scenario("AC-1: Play on a message speaks its text once", ({ Given, And, When, Then }) => {
    let fake: ReturnType<typeof installFakeSynthesis>;

    Given('the phone supports speech synthesis', async () => {
      await freshScreen();
      fake = installFakeSynthesis();
    });

    And('the inbox has one decrypted message', async () => {
      await renderInboxWithOneMessage();
    });

    When('Play is tapped on the message', async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Play' }));
    });

    Then("speech is spoken once with the message's text", () => {
      expect(fake.speak).toHaveBeenCalledTimes(1);
      expect(spokenTextOf(fake.speak)).toBe(MESSAGE_TEXT);
    });
  });

  Scenario(
    'AC-2: Play on a question speaks the question, the recommendation and the options',
    ({ Given, And, When, Then }) => {
      let fake: ReturnType<typeof installFakeSynthesis>;

      Given('the phone supports speech synthesis', async () => {
        await freshScreen();
        fake = installFakeSynthesis();
      });

      And('the Question screen is showing a question', () => {
        render(
          <QuestionScreen question={QUESTION} unlockedKey={new Uint8Array(32)} recipientPublicKeyHex={'02'.repeat(33)} />,
        );
      });

      When('Play is tapped', async () => {
        await userEvent.click(screen.getByRole('button', { name: 'Play' }));
      });

      Then('speech is spoken once with the question, "Recommended: ship" and the options', () => {
        expect(fake.speak).toHaveBeenCalledTimes(1);
        const spoken = spokenTextOf(fake.speak);
        expect(spoken).toContain(QUESTION.q);
        expect(spoken).toContain('Recommended: ship');
        for (const option of QUESTION.options) {
          expect(spoken).toContain(option);
        }
      });
    },
  );

  Scenario('AC-3: a second tap stops the speech', ({ Given, And, When, Then }) => {
    let fake: ReturnType<typeof installFakeSynthesis>;

    Given('the phone supports speech synthesis', async () => {
      await freshScreen();
      fake = installFakeSynthesis();
    });

    And('the inbox has one decrypted message', async () => {
      await renderInboxWithOneMessage();
    });

    And('Play has been tapped on the message', async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Play' }));
    });

    When('Play is tapped again', async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Stop' }));
    });

    Then('the speech is cancelled', () => {
      expect(fake.cancel).toHaveBeenCalledTimes(2);
    });
  });

  Scenario('AC-4: leaving the screen stops the speech', ({ Given, And, When, Then }) => {
    let fake: ReturnType<typeof installFakeSynthesis>;

    Given('the phone supports speech synthesis', async () => {
      await freshScreen();
      fake = installFakeSynthesis();
    });

    And('the inbox has one decrypted message', async () => {
      await renderInboxWithOneMessage();
    });

    And('Play has been tapped on the message', async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Play' }));
    });

    When('the screen is left', () => {
      cleanup();
    });

    Then('the speech is cancelled', () => {
      expect(fake.cancel).toHaveBeenCalledTimes(2);
    });
  });

  Scenario('AC-5: no speech synthesis hides the control', ({ Given, And, Then }) => {
    Given('the phone has no speech synthesis', async () => {
      await freshScreen();
    });

    And('the inbox has one decrypted message', async () => {
      await renderInboxWithOneMessage();
    });

    Then('no Play control is shown', () => {
      expect(screen.queryByRole('button', { name: 'Play' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Stop' })).not.toBeInTheDocument();
    });
  });
});

afterAll(() => {
  cleanup();
  vi.unstubAllGlobals();
});

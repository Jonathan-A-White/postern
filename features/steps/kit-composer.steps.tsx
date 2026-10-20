// features/steps/kit-composer.steps.tsx — runs features/kit-composer.feature (mw-06ggew.5): Postern's Composer is
// voice-kit's Composer with Postern's settings and its own things plugged in (a quote, a tap on a waiting file).
// The send is a double: what reaches sendToThread is the message.
import '@testing-library/react/dont-cleanup-after-each';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterAll, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { Composer } from '../../src/cockpit/Composer';
import type { ThreadRef } from '../../src/services/threads';

const doubles = vi.hoisted(() => ({
  sent: [] as { thread: unknown; text: string; files: unknown[] }[],
}));

vi.mock('../../src/cockpit/send', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/cockpit/send')>()),
  sendToThread: async (thread: unknown, text: string, files: unknown[] = []) => {
    doubles.sent.push({ thread, text, files });
    return [{ id: doubles.sent.length }];
  },
}));

let scenario = 0;
let thread: ThreadRef = { bead: 'mw-kit.0' };
let cleared = 0;
let opened: string[] = [];

afterAll(() => {
  cleanup();
  vi.restoreAllMocks();
});

const feature = await loadFeature('features/kit-composer.feature');

describeFeature(feature, ({ Scenario, BeforeEachScenario }) => {
  BeforeEachScenario(() => {
    cleanup();
    doubles.sent = [];
    cleared = 0;
    opened = [];
    // each scenario its own channel, so no draft of one is put back in the next
    thread = { bead: `mw-kit.${++scenario}` };
    vi.spyOn(window, 'open').mockImplementation((url) => {
      opened.push(String(url));
      return null;
    });
  });

  function open() {
    render(<Composer thread={thread} />);
  }

  Scenario("AC-1: a channel's compose bar is the kit's Composer, opening on the box with attach, camera and the mic in place of Send", ({ Given, Then, And }) => {
    Given("a channel's composer is open", open);
    Then('the compose bar is drawn by the kit', () => {
      const bar = screen.getByTestId('composer');
      expect(bar).toHaveClass('bk-composer');
      expect(bar).toHaveAttribute('data-layout', 'field');
      expect(screen.getByRole('textbox', { name: 'Message' })).toHaveClass('bk-composer__field');
    });
    And('it shows {string}, {string} and {string}', (_c, attach: string, camera: string, mic: string) => {
      for (const name of [attach, camera, mic]) expect(screen.getByRole('button', { name })).toBeInTheDocument();
    });
    And('there is no Send button yet', () => {
      expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();
    });
  });

  Scenario('AC-2: a file waiting to go that is not a picture opens on a tap of its name', ({ Given, When, And, Then }) => {
    Given("a channel's composer is open", open);
    When('he attaches {string} of type {string} with Attach files', async (_c, name: string, type: string) => {
      const input = document.querySelector('input[type="file"][multiple]') as HTMLInputElement;
      await act(async () => fireEvent.change(input, { target: { files: [new File(['%PDF-1.4'], name, { type })] } }));
    });
    And('he taps {string}', async (_c, label: string) => {
      fireEvent.click(await screen.findByRole('button', { name: label }));
    });
    Then('the browser opens the file in a new tab', () => {
      expect(opened).toHaveLength(1);
      expect(opened[0]).toMatch(/^blob:/);
    });
  });

  Scenario('AC-2: a quote with no words goes on Send, the quote at the top of the message', ({ Given, When, Then, And }) => {
    Given("a channel's composer is open with a quote of {string} by {string}", (_c, text: string, speaker: string) => {
      render(<Composer thread={thread} quote={{ speaker, text }} onClearQuote={() => cleared++} />);
    });
    When('he taps Send', async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Send' }));
    });
    Then('one message is sent to the channel beginning {string}', async (_c, start: string) => {
      await waitFor(() => expect(doubles.sent).toHaveLength(1));
      expect(doubles.sent[0].thread).toEqual(thread);
      expect(doubles.sent[0].text.startsWith(start)).toBe(true);
    });
    And('the quote is cleared', async () => {
      await waitFor(() => expect(cleared).toBe(1));
    });
  });
});

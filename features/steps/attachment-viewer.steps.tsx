// features/steps/attachment-viewer.steps.tsx — runs features/attachment-viewer.feature (mw-jtzpw0.5):
// the real Composer, Conversation and picture viewer; the delivery and the blob download are doubles.
import '@testing-library/react/dont-cleanup-after-each';
import { act, cleanup, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterAll, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { Composer } from '../../src/cockpit/Composer';
import { Conversation } from '../../src/cockpit/Conversation';
import { ImageViewer } from '../../src/cockpit/ImageViewer';
import { db, type MessageRow } from '../../src/data/db';
import { mergeConversation } from '../../src/model/conversation';
import { lock, setKey } from '../../src/services/keySession';
import { forgetOutboxState } from '../../src/services/outbox';
import { encodeThreadedMessage } from '../../src/services/threads';

configure({ asyncUtilTimeout: 5000 });

const doubles = vi.hoisted(() => ({ key: new Uint8Array(32).fill(7) }));

vi.mock('../../src/services/keySession', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/keySession')>()),
  getKey: () => doubles.key,
}));
vi.mock('../../src/services/blobs', () => ({ openAttachment: async () => 'blob:attachment' }));

const now = Date.now();
let plaintext = '';
let opened: unknown[][] = [];
let downloads: string[] = [];

function fileInput(): HTMLInputElement {
  return document.querySelector('input[type="file"][multiple]') as HTMLInputElement;
}

async function attach(file: File): Promise<void> {
  await act(async () => {
    fireEvent.change(fileInput(), { target: { files: [file] } });
  });
  await screen.findByLabelText(`Remove ${file.name}`);
}

function sentRow(text: string): MessageRow {
  return {
    id: `${'cd'.repeat(32)}:0`,
    txid: 'cd'.repeat(32),
    vout: 0,
    seq: 1,
    class: 'message',
    to: '02'.padEnd(66, '0'),
    from: '03'.padEnd(66, '0'),
    ts: Math.floor(now / 1000),
    ciphertext: '',
    plaintext: text,
    direction: 'sent',
    read: true,
  };
}

/** Two fingers on the glass, `apart` pixels from each other, then moved. */
function touch(surface: HTMLElement, id: number, x: number, type: 'pointerdown' | 'pointermove'): void {
  fireEvent(surface, new PointerEvent(type, { pointerId: id, clientX: x, clientY: 200, bubbles: true }));
}

afterAll(() => {
  cleanup();
  lock();
  vi.restoreAllMocks();
});

const feature = await loadFeature('features/attachment-viewer.feature');

describeFeature(feature, ({ Scenario, BeforeEachScenario }) => {
  BeforeEachScenario(async () => {
    cleanup();
    vi.restoreAllMocks();
    setKey(doubles.key);
    plaintext = '';
    opened = [];
    downloads = [];
    forgetOutboxState();
    // jsdom has no object URLs; the previews only need a string
    URL.createObjectURL = () => 'blob:preview';
    URL.revokeObjectURL = () => {};
    vi.spyOn(window, 'open').mockImplementation((...args: unknown[]) => {
      opened.push(args);
      return null;
    });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      downloads.push(this.download);
    });
    await Promise.all([db.settings.clear(), db.messages.clear(), db.outbox.clear()]);
  });

  const composerWith = async (file: File) => {
    render(<Composer thread={undefined} />);
    await attach(file);
  };
  const viewerShows = (name: string) => {
    const viewer = screen.getByRole('dialog', { name: 'Picture' });
    expect(within(viewer).getByRole('img')).toHaveAttribute('src', expect.stringMatching(/^blob:/));
    expect(within(viewer).getByText(name)).toBeInTheDocument();
  };
  const viewerGone = async () => {
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Picture' })).toBeNull());
  };
  const stillAttached = (name: string) => {
    expect(screen.getByLabelText(`Remove ${name}`)).toBeInTheDocument();
  };
  const tapOpen = (_c: unknown, name: string) => {
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`(View|Open) ${name.replace('.', '\\.')}`) }));
  };

  Scenario('AC-1: tapping a picture in the composer opens it full screen', ({ Given, When, Then }) => {
    Given('the composer is open with the picture {string} attached', (_c, name: string) => composerWith(new File([new Uint8Array([1, 2, 3])], name, { type: 'image/png' })));
    When('he taps the picture {string}', tapOpen);
    Then('a full-screen viewer shows the picture {string}', (_c, name: string) => viewerShows(name));
  });

  Scenario('AC-1: the close button returns to the composer with the picture still attached', ({ Given, When, And, Then }) => {
    Given('the composer is open with the picture {string} attached', (_c, name: string) => composerWith(new File([new Uint8Array([1, 2, 3])], name, { type: 'image/png' })));
    When('he taps the picture {string}', tapOpen);
    And('he taps Close picture', () => {
      fireEvent.click(screen.getByRole('button', { name: 'Close picture' }));
    });
    Then('the viewer is gone', viewerGone);
    And('the picture {string} is still attached', (_c, name: string) => stillAttached(name));
  });

  Scenario('AC-1: Back returns to the composer with the picture still attached', ({ Given, When, And, Then }) => {
    Given('the composer is open with the picture {string} attached', (_c, name: string) => composerWith(new File([new Uint8Array([1, 2, 3])], name, { type: 'image/png' })));
    When('he taps the picture {string}', tapOpen);
    And('he presses Back', async () => {
      await act(async () => {
        window.history.back();
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
    });
    Then('the viewer is gone', viewerGone);
    And('the picture {string} is still attached', (_c, name: string) => stillAttached(name));
  });

  Scenario('AC-1: the x still removes the picture and opens nothing', ({ Given, When, Then, And }) => {
    Given('the composer is open with the picture {string} attached', (_c, name: string) => composerWith(new File([new Uint8Array([1, 2, 3])], name, { type: 'image/png' })));
    When('he taps the x on {string}', (_c, name: string) => {
      fireEvent.click(screen.getByLabelText(`Remove ${name}`));
    });
    Then('the viewer is gone', viewerGone);
    And('nothing is waiting to be sent', () => {
      expect(screen.queryByLabelText('To send')).toBeNull();
    });
  });

  Scenario('AC-2: tapping a picture in a sent message opens it full screen', ({ Given, When, And, Then }) => {
    Given('a sent message with the picture {string}', (_c, name: string) => {
      plaintext = encodeThreadedMessage({ text: '', attachment: { hash: '01'.repeat(32), size: 900, mime: 'image/png', name } });
    });
    When('the conversation is shown', () => {
      render(<Conversation items={mergeConversation([sentRow(plaintext)])} />);
    });
    And('he taps the picture in the message', async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'View picture' }));
    });
    Then('a full-screen viewer shows the picture {string}', (_c, name: string) => viewerShows(name));
  });

  Scenario('AC-2: a PDF in a sent message opens in a new tab with its name shown', ({ Given, When, Then }) => {
    Given('a sent message with a file {string} of type {string} and {int} bytes', (_c, name: string, mime: string, size: number) => {
      plaintext = encodeThreadedMessage({ text: '', attachment: { hash: '01'.repeat(32), size, mime, name } });
    });
    When('the conversation is shown', () => {
      render(<Conversation items={mergeConversation([sentRow(plaintext)])} />);
    });
    Then('it shows the file {string} with its size {string}', (_c, name: string, size: string) => {
      expect(within(screen.getByTestId('message')).getByRole('button', { name: new RegExp(name) })).toHaveTextContent(`${name} · ${size}`);
    });
    When('he taps the file {string}', (_c, name: string) => {
      fireEvent.click(screen.getByRole('button', { name: new RegExp(name.replace('.', '\\.')) }));
    });
    Then('a new tab is opened', async () => {
      await waitFor(() => expect(opened).toEqual([['blob:attachment', '_blank', 'noopener']]));
    });
  });

  Scenario('AC-2: a PDF attached in the composer opens in a new tab with its name shown', ({ Given, When, Then, And }) => {
    Given('the composer is open with the file {string} of type {string} attached', (_c, name: string, type: string) => composerWith(new File(['%PDF-1.4'], name, { type })));
    When('he taps the file {string}', tapOpen);
    Then('a new tab is opened', async () => {
      await waitFor(() => expect(opened).toEqual([['blob:preview', '_blank', 'noopener']]));
    });
    And('the file {string} is still attached', (_c, name: string) => stillAttached(name));
  });

  Scenario('AC-2: a file the browser cannot show, attached in the composer, is downloaded under its name', ({ Given, When, Then, And }) => {
    Given('the composer is open with the file {string} of type {string} attached', (_c, name: string, type: string) => composerWith(new File([new Uint8Array([80, 75, 3, 4])], name, { type })));
    When('he taps the file {string}', tapOpen);
    Then('the file is downloaded as {string}', async (_c, name: string) => {
      await waitFor(() => expect(downloads).toEqual([name]));
      expect(opened).toEqual([]);
    });
    And('the file {string} is still attached', (_c, name: string) => stillAttached(name));
  });

  Scenario('AC-1: pinching spreads and squeezes the picture between its size and six times that', ({ Given, When, Then }) => {
    Given('a picture shown full screen', () => {
      render(<ImageViewer src="blob:p" name="shot.png" onClose={() => {}} />);
    });
    When('two fingers spread to {int} times their distance', (_c, times: number) => {
      const surface = screen.getByTestId('viewer-surface');
      touch(surface, 1, 100, 'pointerdown');
      touch(surface, 2, 200, 'pointerdown');
      touch(surface, 2, 100 + 100 * times, 'pointermove');
    });
    Then('the picture is {int} times its size', (_c, times: number) => {
      expect(Number(screen.getByTestId('viewer-image').dataset.scale)).toBeCloseTo(times, 5);
    });
    When('two fingers keep spreading to {int} times their distance', (_c, times: number) => {
      touch(screen.getByTestId('viewer-surface'), 2, 100 + 100 * times, 'pointermove');
    });
    Then('the picture stops at {int} times its size', (_c, times: number) => {
      expect(Number(screen.getByTestId('viewer-image').dataset.scale)).toBeCloseTo(times, 5);
    });
    When('two fingers squeeze to a tenth of their distance', () => {
      touch(screen.getByTestId('viewer-surface'), 2, 110, 'pointermove');
    });
    Then('the picture is back at its own size', () => {
      expect(Number(screen.getByTestId('viewer-image').dataset.scale)).toBe(1);
    });
  });

  Scenario('AC-1: a double tap zooms the picture in and the next one back out', ({ Given, When, Then }) => {
    Given('a picture shown full screen', () => {
      render(<ImageViewer src="blob:p" name="shot.png" onClose={() => {}} />);
    });
    When('he double-taps the picture', () => {
      fireEvent.doubleClick(screen.getByTestId('viewer-surface'));
    });
    Then('the picture is zoomed in', () => {
      expect(Number(screen.getByTestId('viewer-image').dataset.scale)).toBeGreaterThan(1);
    });
    When('he double-taps the picture again', () => {
      fireEvent.doubleClick(screen.getByTestId('viewer-surface'));
    });
    Then('the picture is back at its own size', () => {
      expect(Number(screen.getByTestId('viewer-image').dataset.scale)).toBe(1);
    });
  });
});

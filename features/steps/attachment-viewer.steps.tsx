// features/steps/attachment-viewer.steps.tsx — runs features/attachment-viewer.feature (mw-jtzpw0.5):
// the real Composer, Conversation and picture viewer; the delivery and the blob download are doubles.
// Save in the viewer (mw-jtzpw0.7): the phone's download and share sheet are faked, each on or off.
import '@testing-library/react/dont-cleanup-after-each';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterAll, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { Composer } from '../../src/cockpit/Composer';
import { Conversation } from '../../src/cockpit/Conversation';
import { PosternPictureViewer } from '../../src/cockpit/PosternPictureViewer';
import { db, type MessageRow } from '../../src/data/db';
import { mergeConversation } from '../../src/model/conversation';
import { lock, setKey } from '../../src/services/keySession';
import { forgetOutboxState } from '../../src/services/outbox';
import { settlePhone } from '../../tests/support/empty-phone';
import { encodeThreadedMessage } from '../../src/services/threads';
import { freezeClock, thawClock } from '../../tests/support/freeze-clock';

const doubles = vi.hoisted(() => ({ key: new Uint8Array(32).fill(7), picture: undefined as Blob | undefined }));

vi.mock('../../src/services/keySession', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/keySession')>()),
  getKey: () => doubles.key,
}));
// a message's picture, when a scenario gives one, is an object URL of its own bytes (as blobs.ts makes it)
vi.mock('../../src/services/blobs', () => ({
  openAttachment: async () => (doubles.picture ? URL.createObjectURL(doubles.picture) : 'blob:attachment'),
}));

const now = Date.now();
let plaintext = '';
let opened: unknown[][] = [];
let downloads: string[] = [];
// what each object URL was made from, and every link clicked to download
let made = new Map<string, Blob>();
let links: { href: string; download: string }[] = [];
let shared: ShareData[] = [];
let direction: 'sent' | 'received' = 'sent';
const anchorDownload = Object.getOwnPropertyDescriptor(HTMLAnchorElement.prototype, 'download') as PropertyDescriptor;

/** The phone as jsdom has it: links download, there is no share sheet, and the real fetch. */
function ordinaryPhone(): void {
  Object.defineProperty(HTMLAnchorElement.prototype, 'download', anchorDownload);
  Reflect.deleteProperty(navigator, 'share');
  Reflect.deleteProperty(navigator, 'canShare');
  vi.unstubAllGlobals();
}

/** A phone whose links do not download (`download` is not on an <a>), as feature detection sees it. */
function noDownload(): void {
  Reflect.deleteProperty(HTMLAnchorElement.prototype, 'download');
}

/** A phone with a share sheet that takes files; reading an object URL back gives the blob it was made from. */
function shareSheet(): void {
  Object.defineProperty(navigator, 'canShare', { configurable: true, value: (data: ShareData) => Boolean(data.files?.length) });
  Object.defineProperty(navigator, 'share', {
    configurable: true,
    value: async (data: ShareData) => {
      shared.push(data);
    },
  });
  vi.stubGlobal('fetch', async (url: string) => ({ blob: async () => made.get(url) }));
}

/** A message carrying the picture `name` of `type`, its bytes the scenario's own. */
function pictureMessage(towards: 'sent' | 'received', name: string, type: string): void {
  direction = towards;
  doubles.picture = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 7, 7, 7])], { type });
  plaintext = encodeThreadedMessage({ text: '', attachment: { hash: '02'.repeat(32), size: 6, mime: type, name } });
}

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
  return direction === 'sent' ? row(text, 'sent') : { ...row(text, 'received'), to: '03'.padEnd(66, '0'), from: '02'.padEnd(66, '0') };
}

function row(text: string, towards: 'sent' | 'received'): MessageRow {
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
    direction: towards,
    read: true,
  };
}

/** Two fingers on the glass, `apart` pixels from each other, then moved. */
function touch(surface: HTMLElement, id: number, x: number, type: 'pointerdown' | 'pointermove'): void {
  fireEvent(surface, new PointerEvent(type, { pointerId: id, clientX: x, clientY: 200, bubbles: true }));
}

afterAll(() => {
  cleanup();
  thawClock();
  ordinaryPhone();
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
    made = new Map();
    links = [];
    shared = [];
    direction = 'sent';
    doubles.picture = undefined;
    thawClock();
    ordinaryPhone();
    await settlePhone();
    forgetOutboxState();
    // jsdom has no object URLs; the previews only need a string, a message's picture its own
    URL.createObjectURL = (blob: Blob | MediaSource) => {
      if (blob !== doubles.picture) return 'blob:preview';
      const url = `blob:picture-${made.size + 1}`;
      made.set(url, blob);
      return url;
    };
    URL.revokeObjectURL = () => {};
    vi.spyOn(window, 'open').mockImplementation((...args: unknown[]) => {
      opened.push(args);
      return null;
    });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      downloads.push(this.download);
      links.push({ href: this.href, download: this.download });
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
      render(<PosternPictureViewer picture={{ src: 'blob:p', name: 'shot.png' }} onClose={() => {}} />);
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
      render(<PosternPictureViewer picture={{ src: 'blob:p', name: 'shot.png' }} onClose={() => {}} />);
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

  const openThePicture = async () => {
    fireEvent.click(await screen.findByRole('button', { name: 'View picture' }));
    await screen.findByRole('dialog', { name: 'Picture' });
  };
  const tapSave = () => {
    fireEvent.click(screen.getByRole('button', { name: 'Save picture' }));
  };
  const downloadedOwnBytes = async (_c: unknown, name: string, type: string) => {
    await waitFor(() => expect(links).toHaveLength(1));
    expect(links[0].download).toBe(name);
    // the link is the object URL the message's picture was made from: its own blob, bytes and type
    expect(made.get(links[0].href)).toBe(doubles.picture);
    expect(made.get(links[0].href)?.type).toBe(type);
  };
  const conversationShown = () => {
    render(<Conversation items={mergeConversation([sentRow(plaintext)])} />);
  };

  Scenario("AC-2: Save on a picture in his own sent message downloads it under its name, its own bytes and type (mw-jtzpw0.7)", ({ Given, When, And, Then }) => {
    Given('a sent message with the picture {string} of type {string}', (_c, name: string, type: string) => pictureMessage('sent', name, type));
    When('the conversation is shown', conversationShown);
    And('he opens the picture in the message', openThePicture);
    And('he taps Save picture', tapSave);
    Then("a link downloads {string} from the picture's own bytes of type {string}", downloadedOwnBytes);
    And('the viewer says the picture was saved', async () => {
      expect(await screen.findByText('Saved receipt.jpg to Downloads')).toBeInTheDocument();
      // used, the button goes dead and says so
      await waitFor(() => expect(screen.getByRole('button', { name: 'Save picture' })).toBeDisabled());
      expect(screen.getByRole('button', { name: 'Save picture' })).toHaveTextContent('Saved');
    });
  });

  Scenario("AC-4: Save on a picture in a received message downloads it under its name, its own bytes and type (mw-jtzpw0.7)", ({ Given, When, And, Then }) => {
    Given('a received message with the picture {string} of type {string}', (_c, name: string, type: string) => pictureMessage('received', name, type));
    When('the conversation is shown', conversationShown);
    And('he opens the picture in the message', openThePicture);
    And('he taps Save picture', tapSave);
    Then("a link downloads {string} from the picture's own bytes of type {string}", downloadedOwnBytes);
  });

  Scenario('AC-2: a picture with no name of its own is saved as postern and the date (mw-jtzpw0.7)', ({ Given, When, Then }) => {
    Given('a picture with no name shown full screen on 2026-10-10', () => {
      freezeClock('2026-10-10T00:25:00Z');
      render(<PosternPictureViewer picture={{ src: 'blob:p' }} onClose={() => {}} />);
    });
    When('he taps Save picture', tapSave);
    Then('a link downloads {string}', async (_c, name: string) => {
      await waitFor(() => expect(downloads).toEqual([name]));
    });
  });

  Scenario('AC-3: a phone that can download does not open the share sheet (mw-jtzpw0.7)', ({ Given, And, When, Then }) => {
    Given('a phone that can download and share', shareSheet);
    And('a sent message with the picture {string} of type {string}', (_c, name: string, type: string) => pictureMessage('sent', name, type));
    When('the conversation is shown', conversationShown);
    And('he opens the picture in the message', openThePicture);
    And('he taps Save picture', tapSave);
    Then("a link downloads {string} from the picture's own bytes of type {string}", downloadedOwnBytes);
    And('the share sheet was not opened', () => {
      expect(shared).toEqual([]);
    });
  });

  Scenario('AC-3: a phone that cannot download hands the picture to the share sheet (mw-jtzpw0.7)', ({ Given, And, When, Then }) => {
    Given('a phone that can share but not download', () => {
      shareSheet();
      noDownload();
    });
    And('a received message with the picture {string} of type {string}', (_c, name: string, type: string) => pictureMessage('received', name, type));
    When('the conversation is shown', conversationShown);
    And('he opens the picture in the message', openThePicture);
    And('he taps Save picture', tapSave);
    Then("the share sheet gets {string} with the picture's own bytes of type {string}", async (_c, name: string, type: string) => {
      await waitFor(() => expect(shared).toHaveLength(1));
      const [file] = shared[0].files ?? [];
      expect(file.name).toBe(name);
      expect(file.type).toBe(type);
      expect(new Uint8Array(await file.arrayBuffer())).toEqual(new Uint8Array(await (doubles.picture as Blob).arrayBuffer()));
    });
    And('nothing was downloaded', () => {
      expect(links).toEqual([]);
    });
    And('the viewer says the picture was shared', async () => {
      expect(await screen.findByText('Shared wall.png')).toBeInTheDocument();
    });
  });

  Scenario('AC-3: a phone that can neither download nor share says the picture was not saved (mw-jtzpw0.7)', ({ Given, And, When, Then }) => {
    Given('a phone that can neither download nor share', noDownload);
    And('a picture {string} shown full screen', (_c, name: string) => {
      render(<PosternPictureViewer picture={{ src: 'blob:p', name, type: 'image/png' }} onClose={() => {}} />);
    });
    When('he taps Save picture', tapSave);
    Then('the viewer says the picture could not be saved', async () => {
      // wait for the words, not the status strip: the strip is there, empty, before they land
      expect(await screen.findByText('Could not save this picture')).toBeInTheDocument();
      expect(links).toEqual([]);
    });
  });
});

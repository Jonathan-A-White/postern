// features/steps/conversation-scroll.steps.tsx — runs features/conversation-scroll.feature
// (mw-jkrnxu.1): a conversation scrolls its own scroll box to the newest message and never the
// document, so an open keyboard and a banner appearing cannot push the screen up. jsdom does no
// layout, so the box's scrollHeight/clientHeight/scrollTop are faked: scrollTop clamps to the
// content that is there, as a browser's does.
import '@testing-library/react/dont-cleanup-after-each';
import { render, screen, cleanup, act, configure, fireEvent } from '@testing-library/react';
import { afterAll, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { Conversation } from '../../src/cockpit/Conversation';
import type { ConversationItem } from '../../src/model/conversation';

configure({ asyncUtilTimeout: 5000 });

const VIEW = 100;
const ROW = 80;

function item(n: number): ConversationItem {
  return { id: `m${n}`, at: Date.UTC(2026, 9, 2, 12, n), speaker: 'mayor', speakerLabel: 'Mayor', kind: 'text', text: `Message ${n}`, source: 'message' };
}

let count = 3;
let scrollOnOpen = true;
let intoView = vi.fn();

const tops = new WeakMap<Element, number>();
const isBox = (el: Element) => el.getAttribute('data-testid') === 'box';
// the content is what is drawn: a long conversation draws only its newest window (mw-q6n8m0.6)
const content = (el: Element) => el.querySelectorAll('[data-testid="message"]').length * ROW;

/** The box clamps scrollTop to the content behind it, as a browser's does. It is faked on the
 * prototype because the conversation's layout effect runs before a parent's ref is attached. */
const LAYOUT = ['scrollHeight', 'clientHeight', 'scrollTop'] as const;
const original = LAYOUT.map((name) => [name, Object.getOwnPropertyDescriptor(Element.prototype, name)] as const);

function fakeLayout(): void {
  Object.defineProperties(Element.prototype, {
    scrollHeight: { configurable: true, get: function (this: Element) { return isBox(this) ? content(this) : 0; } },
    clientHeight: { configurable: true, get: function (this: Element) { return isBox(this) ? VIEW : 0; } },
    scrollTop: {
      configurable: true,
      get: function (this: Element) { return tops.get(this) ?? 0; },
      set: function (this: Element, value: number) {
        tops.set(this, isBox(this) ? Math.min(Math.max(0, value), Math.max(0, content(this) - VIEW)) : value);
      },
    },
  });
}

// eslint-disable-next-line react-refresh/only-export-components
function Harness({ n }: { n: number }) {
  return (
    <div>
      <div data-testid="box" style={{ overflowY: 'auto' }}>
        <Conversation items={Array.from({ length: n }, (_, i) => item(i + 1))} scrollOnOpen={scrollOnOpen} />
      </div>
    </div>
  );
}

const box = () => screen.getByTestId('box') as HTMLElement;

let rerenderFn: ((ui: React.ReactElement) => void) | undefined;

function open(): void {
  rerenderFn = render(<Harness n={count} />).rerender;
}

function arrive(): void {
  count += 1;
  act(() => rerenderFn?.(<Harness n={count} />));
}

function fresh(): void {
  cleanup();
  count = 3;
  scrollOnOpen = true;
  intoView = vi.fn();
  fakeLayout();
  document.documentElement.scrollTop = 0;
  document.body.scrollTop = 0;
  Element.prototype.scrollIntoView = intoView;
  rerenderFn = undefined;
}

afterAll(() => {
  cleanup();
  // @ts-expect-error jsdom has none; the steps stubbed one
  delete Element.prototype.scrollIntoView;
  for (const [name, descriptor] of original) {
    if (descriptor) Object.defineProperty(Element.prototype, name, descriptor);
    else Reflect.deleteProperty(Element.prototype, name);
  }
});

const feature = await loadFeature('features/conversation-scroll.feature');

describeFeature(feature, ({ Scenario, BeforeEachScenario }) => {
  BeforeEachScenario(fresh);

  Scenario('mw-jkrnxu.1: a new message scrolls the conversation\'s own box to the bottom and the page stays put', ({ Given, When, Then, And }) => {
    Given('a conversation of 3 messages open in its own scroll box', () => {
      open();
    });
    When('a new message arrives', arrive);
    Then("the conversation's box is scrolled to its bottom", () => {
      expect(box().scrollTop).toBe(count * ROW - VIEW);
      expect(box().scrollTop).toBeGreaterThan(0);
    });
    And('the page itself is not scrolled, and no scrollIntoView was asked of the page', () => {
      expect(document.documentElement.scrollTop).toBe(0);
      expect(document.body.scrollTop).toBe(0);
      expect(intoView).not.toHaveBeenCalled();
    });
  });

  Scenario('mw-jkrnxu.1: a conversation that opens scrolls its own box to the newest message', ({ Given, Then, And }) => {
    Given('a conversation of 3 messages open in its own scroll box', open);
    Then("the conversation's box is scrolled to its bottom", () => {
      expect(box().scrollTop).toBe(count * ROW - VIEW);
      expect(box().scrollTop).toBeGreaterThan(0);
    });
    And('the page itself is not scrolled, and no scrollIntoView was asked of the page', () => {
      expect(document.documentElement.scrollTop).toBe(0);
      expect(document.body.scrollTop).toBe(0);
      expect(intoView).not.toHaveBeenCalled();
    });
  });

  Scenario('mw-q6n8m0.6: Show earlier keeps the messages he was reading where they were', ({ Given, When, Then }) => {
    Given('a conversation of 100 messages open in its own scroll box', () => {
      count = 100;
      open();
    });
    When('he scrolls to the top and taps Show earlier', () => {
      box().scrollTop = 0;
      fireEvent.click(screen.getByText(/Show earlier/));
    });
    Then('the 40 earlier messages are above and the box is scrolled past them', () => {
      expect(screen.getAllByTestId('message')).toHaveLength(100);
      expect(box().scrollTop).toBe(40 * ROW);
    });
  });

  Scenario('mw-jkrnxu.1: a conversation told not to scroll on open leaves its box alone until a new message comes', ({ Given, When, Then }) => {
    Given('a conversation of 3 messages open in its own scroll box that is not to scroll on open', () => {
      scrollOnOpen = false;
      open();
    });
    Then("the conversation's box is scrolled to the top", () => {
      expect(box().scrollTop).toBe(0);
    });
    When('a new message arrives', arrive);
    Then("the conversation's box is scrolled to its bottom", () => {
      expect(box().scrollTop).toBe(count * ROW - VIEW);
    });
  });
});

// features/steps/scroll-back.steps.tsx — runs features/scroll-back.feature (mw-f758y.35): a
// scrolling box that remembers where he left it. jsdom does no layout, so the box's
// scrollHeight/clientHeight/scrollTop are faked: scrollTop clamps to the content that is there,
// as a browser's does, and the content's ResizeObserver is driven by hand.
import '@testing-library/react/dont-cleanup-after-each';
import { render, screen, cleanup, waitFor, fireEvent, act, configure } from '@testing-library/react';
import { afterAll, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { navigate, useScreenSearch } from '../../src/router';
import { forgetScrolls, useScrollMemory } from '../../src/nav/scrollMemory';

configure({ asyncUtilTimeout: 5000 });

const VIEW = 100;
let content = 1000;
let box: { top: number } | undefined;
const observers = new Set<() => void>();

class FakeResizeObserver {
  constructor(private readonly callback: () => void) {}
  observe() {
    observers.add(this.callback);
  }
  unobserve() {}
  disconnect() {
    observers.delete(this.callback);
  }
}

/** A box whose scrollTop clamps to the content behind it and says so with a scroll event. */
function fakeLayout(el: HTMLElement | null): void {
  if (!el) return;
  const state = { top: 0 };
  box = state;
  Object.defineProperties(el, {
    scrollHeight: { configurable: true, get: () => content },
    clientHeight: { configurable: true, get: () => VIEW },
    scrollTop: {
      configurable: true,
      get: () => Math.min(state.top, Math.max(0, content - VIEW)),
      set: (value: number) => {
        state.top = Math.min(Math.max(0, value), Math.max(0, content - VIEW));
        el.dispatchEvent(new Event('scroll'));
      },
    },
  });
}

// eslint-disable-next-line react-refresh/only-export-components
function List() {
  const remember = useScrollMemory('page');
  return (
    <div
      data-testid="list"
      ref={(el) => {
        fakeLayout(el);
        remember(el);
      }}
    >
      <div>the list</div>
    </div>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
function Harness() {
  const search = useScreenSearch();
  return search.includes('other') ? <p>Another screen</p> : <List key={search} />;
}

const scrollTop = () => (screen.getByTestId('list') as HTMLElement).scrollTop;
const scrollTo = (top: number) => {
  (screen.getByTestId('list') as HTMLElement).scrollTop = top;
};

async function fresh(): Promise<void> {
  cleanup();
  forgetScrolls();
  observers.clear();
  content = 1000;
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  window.history.replaceState(null, '', '/?v=first');
}

async function open(): Promise<void> {
  render(<Harness />);
  await screen.findByTestId('list');
}

async function leave(): Promise<void> {
  act(() => navigate('?v=other'));
  await screen.findByText('Another screen');
}

async function comeBack(): Promise<void> {
  act(() => window.history.back());
  await screen.findByTestId('list');
}

afterAll(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.pushState({}, '', '/');
});

const feature = await loadFeature('features/scroll-back.feature');

describeFeature(feature, ({ Scenario, BeforeEachScenario }) => {
  BeforeEachScenario(fresh);

  Scenario('mw-f758y.35: a screen scrolled down is scrolled to the same place when he comes back to it', ({ Given, When, Then }) => {
    Given('a screen with a long list, scrolled to 300', async () => {
      await open();
      scrollTo(300);
    });
    When('he goes to another screen and comes back', async () => {
      await leave();
      await comeBack();
    });
    Then('the list is scrolled to 300', async () => {
      await waitFor(() => expect(scrollTop()).toBe(300));
    });
  });

  Scenario('mw-f758y.35: each address keeps its own position', ({ Given, When, Then }) => {
    Given('a screen with a long list, scrolled to 300', async () => {
      await open();
      scrollTo(300);
    });
    When('he goes to a second address, scrolls it to 120, and returns to the first', async () => {
      act(() => navigate('?v=second'));
      await waitFor(() => expect(window.location.search).toBe('?v=second'));
      await screen.findByTestId('list');
      scrollTo(120);
      await leave();
      act(() => window.history.go(-2));
      await waitFor(() => expect(window.location.search).toBe('?v=first'));
      await screen.findByTestId('list');
    });
    Then('the list is scrolled to 300', async () => {
      await waitFor(() => expect(scrollTop()).toBe(300));
    });
  });

  Scenario('mw-f758y.35: a list that fills in after he comes back still ends where he left it', ({ Given, When, And, Then }) => {
    Given('a screen with a long list, scrolled to 300', async () => {
      await open();
      scrollTo(300);
    });
    When('he goes to another screen and comes back while the list is still short', async () => {
      await leave();
      content = 150;
      await comeBack();
    });
    And('the rest of the list arrives', () => {
      content = 1000;
      act(() => observers.forEach((callback) => callback()));
    });
    Then('the list is scrolled to 300', async () => {
      await waitFor(() => expect(scrollTop()).toBe(300));
    });
  });

  Scenario('mw-f758y.35: an address he never scrolled opens as it always did', ({ Given, When, Then }) => {
    Given('a screen with a long list, never scrolled', async () => {
      await open();
    });
    When('he goes to another screen and comes back', async () => {
      await leave();
      await comeBack();
    });
    Then('the list is scrolled to 0', () => {
      expect(scrollTop()).toBe(0);
    });
  });

  Scenario('mw-f758y.35: scrolling again after he comes back is not undone by the old position', ({ Given, When, And, Then }) => {
    Given('a screen with a long list, scrolled to 300', async () => {
      await open();
      scrollTo(300);
    });
    When('he goes to another screen and comes back while the list is still short', async () => {
      await leave();
      content = 150;
      await comeBack();
    });
    And('he scrolls the short list himself', () => {
      fireEvent.wheel(screen.getByTestId('list'));
      scrollTo(20);
    });
    And('the rest of the list arrives', () => {
      content = 1000;
      act(() => observers.forEach((callback) => callback()));
    });
    Then('the list is scrolled to where he put it', () => {
      expect(box?.top).toBe(20);
      expect(scrollTop()).toBe(20);
    });
  });
});

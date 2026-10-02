// features/steps/sw-asset-guard.steps.ts — runs features/sw-asset-guard.feature (mw-j0f2d.41): the
// real src/sw.ts (tests/support/sw-harness.ts) over a fake precache holding a stylesheet.
import { beforeAll, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { loadWorker, type WorkerHarness } from '../../tests/support/sw-harness';

const URL_OF_CSS = `${window.location.origin}/assets/index-X.css`;
const asHtml = () => new Response('<!doctype html>', { headers: { 'Content-Type': 'text/html' } });
const asCss = () => new Response('body{}', { headers: { 'Content-Type': 'text/css' } });

let worker: WorkerHarness;
let store: Map<string, Response>;
let fetchImpl: ReturnType<typeof vi.fn>;
let answer: Response | undefined;

function precacheHolds(stylesheet: Response): void {
  store = new Map([[URL_OF_CSS, stylesheet]]);
  const cache = {
    keys: async () => [...store.keys()].map((url) => new Request(url)),
    match: async (request: Request | string) => store.get(typeof request === 'string' ? request : request.url)?.clone(),
    delete: async (request: Request | string) => store.delete(typeof request === 'string' ? request : request.url),
    put: async (request: Request | string, response: Response) => void store.set(typeof request === 'string' ? request : request.url, response),
  };
  vi.stubGlobal('caches', { keys: async () => [`workbox-precache-v2-${window.location.origin}/`], open: async () => cache });
  fetchImpl = vi.fn(async () => asCss());
  vi.stubGlobal('fetch', fetchImpl);
}

const feature = await loadFeature('features/sw-asset-guard.feature');

describeFeature(feature, ({ BeforeEachScenario, AfterEachScenario, Scenario }) => {
  beforeAll(async () => {
    worker = await loadWorker();
  });
  BeforeEachScenario(async () => {
    worker = await loadWorker();
    answer = undefined;
  });
  AfterEachScenario(() => {
    vi.unstubAllGlobals();
  });

  Scenario('mw-j0f2d.41 AC-1: a precached stylesheet that is the app page is deleted and fetched again when the worker activates', ({ Given, When, Then }) => {
    Given("the phone's precache holds a stylesheet that is really the app page", () => precacheHolds(asHtml()));
    When('the worker activates', () => worker.activate());
    Then('the stylesheet in the precache is text/css fetched from the network', () => {
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(store.get(URL_OF_CSS)?.headers.get('Content-Type')).toBe('text/css');
    });
  });

  Scenario('mw-j0f2d.41 AC-1b: a precached stylesheet that is text/css is kept when the worker activates', ({ Given, When, Then }) => {
    Given("the phone's precache holds a stylesheet that is text/css", () => precacheHolds(asCss()));
    When('the worker activates', () => worker.activate());
    Then('the network was not asked for it', () => {
      expect(fetchImpl).not.toHaveBeenCalled();
    });
  });

  Scenario('mw-j0f2d.41 AC-2: a request for a stylesheet whose cached copy is the app page goes to the network', ({ Given, When, Then }) => {
    Given("the phone's precache holds a stylesheet that is really the app page", () => precacheHolds(asHtml()));
    When('the page asks for the stylesheet', async () => {
      answer = await worker.fetch(URL_OF_CSS);
    });
    Then('it gets text/css from the network', () => {
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(answer?.headers.get('Content-Type')).toBe('text/css');
    });
  });
});

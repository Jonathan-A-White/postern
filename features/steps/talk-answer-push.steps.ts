// features/steps/talk-answer-push.steps.ts — runs features/talk-answer-push.feature (mw-j0f2d.38):
// the real src/sw.ts (tests/support/sw-harness.ts) is sent the push the backend sends for the
// Mayor's talk answer, with a fake window for the open app.
import { beforeAll, expect } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { fakeWindowClient, loadWorker, type FakeWindowClient, type WorkerHarness } from '../../tests/support/sw-harness';

const TXID = `direct:${'ef'.repeat(32)}`;

let worker: WorkerHarness;
let app: FakeWindowClient;

function arrive(): Promise<void> {
  return worker.push({ class: 'talk', txid: TXID, ts: 1_790_000_000 });
}

const feature = await loadFeature('features/talk-answer-push.feature');

describeFeature(feature, ({ BeforeEachScenario, Scenario }) => {
  beforeAll(async () => {
    worker = await loadWorker();
  });
  BeforeEachScenario(async () => {
    worker = await loadWorker();
  });

  Scenario('mw-j0f2d.38 AC-2: a talk answer\'s push shows "The Mayor answered" when the app is not on his screen', ({ Given, When, Then }) => {
    Given('the app is open but hidden', () => {
      app = fakeWindowClient();
      app.visibilityState = 'hidden';
      worker.openWindows.push(app);
    });
    When('the push for a talk answer arrives', arrive);
    Then('a notification titled "The Mayor answered" is shown with none of the answer\'s words', () => {
      expect(worker.shown).toHaveLength(1);
      expect(worker.shown[0].title).toBe('The Mayor answered');
      expect(worker.shown[0].options.body).toBeUndefined();
    });
  });

  Scenario('mw-j0f2d.38 AC-2b: a talk answer\'s push shows nothing while the app is on his screen', ({ Given, When, Then }) => {
    Given('the app is focused and visible', () => {
      worker.openWindows.push(fakeWindowClient());
    });
    When('the push for a talk answer arrives', arrive);
    Then('no talk notification is shown', () => {
      expect(worker.shown).toHaveLength(0);
    });
  });

  Scenario('mw-j0f2d.38 AC-2c: a tap on the talk answer\'s notification opens the Talk line', ({ Given, When, Then, And }) => {
    Given('the app is open but hidden', () => {
      app = fakeWindowClient();
      app.visibilityState = 'hidden';
      worker.openWindows.push(app);
    });
    And('the push for a talk answer arrives', arrive);
    When('he taps the notification', () => worker.click(worker.open[worker.open.length - 1]));
    Then('the app is sent to the Talk line', () => {
      expect(app.postMessage).toHaveBeenCalledWith({ type: 'open', url: '/?v=line' });
    });
  });
});

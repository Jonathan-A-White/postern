// mw-gq6.936: a gate:shots test hung 2 minutes 'while setting up "page"' and the gate log said no more than that, so
// the next hang has to say what the setup was waiting on. This feeds the watch Playwright's own protocol lines, as a
// worker hears them, on a clock the test moves.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PageSetupWatch, type HostReading } from '../support/page-setup-watch';

const host: HostReading = { load: 27.3, cores: 16, availableGb: 1.2, totalGb: 11.7, swapUsedGb: 3.1, memoryFull: 41.2, processes: '123 S browser, 130 D renderer' };

function watchOnAClock() {
  let now = 1_000_000;
  const lines: string[] = [];
  const watch = new PageSetupWatch({ worker: '3', now: () => now, readHost: () => host, say: (line) => lines.push(line) });
  return {
    watch,
    lines,
    advance(ms: number) {
      now += ms;
      watch.check();
    },
    send: (id: number, method: string) => watch.heard(`2026-11-04T00:08:07.938Z pw:protocol SEND ► {"id":${id},"method":"${method}","params":{}}`),
    answer: (id: number) => watch.heard(`2026-11-04T00:08:07.938Z pw:protocol ◀ RECV {"id":${id},"result":{}}`),
    event: (method: string) => watch.heard(`2026-11-04T00:08:07.938Z pw:protocol ◀ RECV {"method":"${method}","params":{}}`),
  };
}

describe('PageSetupWatch', () => {
  it('says nothing while a page sets up in good time', () => {
    const { lines, advance, send, answer } = watchOnAClock();
    send(1, 'Target.createTarget');
    advance(170);
    answer(1);
    send(2, 'Page.navigate');
    advance(120_000);
    expect(lines).toEqual([]);
  });

  it('says nothing when no page is being set up, however long a call takes', () => {
    const { lines, advance, send } = watchOnAClock();
    send(1, 'Runtime.callFunctionOn');
    advance(120_000);
    expect(lines).toEqual([]);
  });

  it('at 30 s says which calls have no answer, what the browser last said, and how the host is', () => {
    const { lines, advance, send, answer, event } = watchOnAClock();
    send(1, 'Target.createTarget');
    advance(100);
    event('Target.attachedToTarget');
    send(2, 'Page.enable');
    send(3, 'Page.getFrameTree');
    answer(2);
    advance(29_800);
    expect(lines).toEqual([]);
    advance(100);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^page-setup-watch: worker 3: page setup 30 s old/);
    expect(lines[0]).toContain('no answer to Target.createTarget (30.0 s), Page.getFrameTree (29.9 s)');
    expect(lines[0]).not.toContain('Page.enable (');
    expect(lines[0]).toContain('last from the browser 29.9 s ago: reply to Page.enable');
    expect(lines[0]).toContain('load 27.3 of 16');
    expect(lines[0]).toContain('1.2 of 11.7 GB free');
    expect(lines[0]).toContain('swap 3.1 GB used');
    expect(lines[0]).toContain('memory pressure full 41.2');
    expect(lines[0]).toContain('123 S browser, 130 D renderer');
  });

  it('says it a second time at 100 s, then no more, so the log shows whether anything moved', () => {
    const { lines, advance, send } = watchOnAClock();
    send(1, 'Target.createTarget');
    advance(30_000);
    advance(30_000);
    expect(lines).toHaveLength(1);
    advance(40_000);
    expect(lines).toHaveLength(2);
    expect(lines[1]).toMatch(/page setup 100 s old/);
    advance(100_000);
    expect(lines).toHaveLength(2);
  });

  it('a setup that it spoke about and that then went through says so: slow, not hung', () => {
    const { lines, advance, send, answer } = watchOnAClock();
    send(1, 'Target.createTarget');
    advance(45_000);
    answer(1);
    send(2, 'Page.navigate');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toBe('page-setup-watch: worker 3: page setup went through after 45 s');
  });

  it('a setup it spoke about that was taken down says so: the hang, ended by the test timeout', () => {
    const { lines, advance, send } = watchOnAClock();
    send(1, 'Target.createTarget');
    advance(120_000);
    send(2, 'Target.disposeBrowserContext');
    expect(lines[lines.length - 1]).toBe('page-setup-watch: worker 3: page setup ended unfinished after 120 s');
  });

  it('watches the context too: "while setting up context" has the same blindness', () => {
    const { lines, advance, send } = watchOnAClock();
    send(1, 'Target.createBrowserContext');
    advance(30_000);
    expect(lines[0]).toContain('no answer to Target.createBrowserContext (30.0 s)');
  });

  it('a page taken down before it navigated ends the watch', () => {
    const { lines, advance, send } = watchOnAClock();
    send(1, 'Target.createTarget');
    advance(1000);
    send(2, 'Target.disposeBrowserContext');
    advance(120_000);
    expect(lines).toEqual([]);
  });

  it('counts the 30 s from the context, when a page follows it', () => {
    const { lines, advance, send, answer } = watchOnAClock();
    send(1, 'Target.createBrowserContext');
    advance(20_000);
    answer(1);
    send(2, 'Target.createTarget');
    advance(10_000);
    expect(lines[0]).toMatch(/page setup 30 s old/);
    expect(lines[0]).toContain('no answer to Target.createTarget (10.0 s)');
  });

  it('reads a reply that failed as a reply', () => {
    const { lines, advance, send, watch } = watchOnAClock();
    send(1, 'Target.createTarget');
    watch.heard('2026-11-04T00:08:07.938Z pw:protocol ◀ RECV {"id":1,"error":{"message":"gone"}}');
    advance(30_000);
    expect(lines[0]).toContain('every call has its answer');
  });

  it('keeps the browser\'s pid and its last words, and gives them in the line', () => {
    const { lines, advance, send, watch } = watchOnAClock();
    watch.heard('2026-11-04T00:08:07.938Z pw:browser <launched> pid=4242');
    watch.heard('2026-11-04T00:08:07.938Z pw:browser [pid=4242][err] Failed to connect to the bus');
    expect(watch.browserPid()).toBe(4242);
    send(1, 'Target.createTarget');
    advance(30_000);
    expect(lines[0]).toContain('browser said: Failed to connect to the bus');
  });

  it('hears the browser through the colour codes debug adds on a terminal', () => {
    const { watch } = watchOnAClock();
    watch.heard('  \u001B[38;5;0;1mpw:browser \u001B[0m<launched> pid=4242');
    expect(watch.browserPid()).toBe(4242);
  });

  it('a browser that exits hands back to the one still running, so the line never names a dead one', () => {
    const { watch } = watchOnAClock();
    watch.heard('2026-11-04T00:08:07.938Z pw:browser <launched> pid=1');
    watch.heard('2026-11-04T00:08:07.938Z pw:browser <launched> pid=2');
    expect(watch.browserPid()).toBe(2);
    watch.heard('2026-11-04T00:08:07.938Z pw:browser [pid=2] <process did exit: exitCode=0, signal=null>');
    expect(watch.browserPid()).toBe(1);
    watch.heard('2026-11-04T00:08:07.938Z pw:browser [pid=99] <process did exit: exitCode=0, signal=null>');
    expect(watch.browserPid()).toBe(1);
  });

  it('a screencast frame costs no parse: only its head is read', () => {
    const { lines, advance, send, event } = watchOnAClock();
    send(1, 'Target.createTarget');
    event('Page.screencastFrame');
    advance(30_000);
    expect(lines[0]).toContain('last from the browser 30.0 s ago: Page.screencastFrame');
  });
});

// mw-gq6.946: two after-landing shots tests waited 2 minutes on page setups whose renderer was gone: Chrome detached the
// page's inspector ('Render process gone.') and closed nothing, and Playwright 1.63 waits only on answers and on a close.
describe('PageSetupWatch: a page whose target detached during its setup', () => {
  const detach = (session: string, reason = 'Render process gone.') =>
    `2026-11-04T00:08:07.938Z pw:protocol ◀ RECV {"method":"Inspector.detached","params":{"reason":"${reason}"},"sessionId":"${session}"}`;

  function setupOnSession(session: string) {
    const clock = watchOnAClock();
    clock.send(1, 'Target.createTarget');
    clock.answer(1);
    clock.watch.heard(`2026-11-04T00:08:07.938Z pw:protocol SEND ► {"id":2,"method":"Runtime.runIfWaitingForDebugger","sessionId":"OMNIBOX"}`);
    clock.watch.heard(`2026-11-04T00:08:07.938Z pw:protocol SEND ► {"id":3,"method":"Page.enable","sessionId":"${session}"}`);
    return clock;
  }

  it('names the detach, its reason, and whether it was the page or another target', () => {
    const { watch, lines, advance } = setupOnSession('PAGE');
    watch.heard(detach('OMNIBOX'));
    advance(30_000);
    expect(lines[0]).toContain('last from the browser 30.0 s ago: Inspector.detached (Render process gone.) from another target');
    watch.heard(detach('PAGE'));
    advance(70_000);
    expect(lines[1]).toContain('Inspector.detached (Render process gone.) from the page');
  });

  it("tells whoever waits on the page's session, once, and not for another session's detach", () => {
    const { watch } = setupOnSession('PAGE');
    const heard: string[] = [];
    watch.whenDetached('PAGE', (reason) => heard.push(reason));
    watch.heard(detach('OMNIBOX'));
    expect(heard).toEqual([]);
    watch.heard(detach('PAGE'));
    watch.heard(detach('PAGE'));
    expect(heard).toEqual(['Render process gone.']);
  });

  it('a wait that begins after the detach hears it at once', () => {
    const { watch } = setupOnSession('PAGE');
    watch.heard(detach('PAGE'));
    const heard: string[] = [];
    watch.whenDetached('PAGE', (reason) => heard.push(reason));
    expect(heard).toEqual(['Render process gone.']);
  });

  it('a wait that stops listening hears nothing', () => {
    const { watch } = setupOnSession('PAGE');
    const heard: string[] = [];
    watch.whenDetached('PAGE', (reason) => heard.push(reason))();
    watch.heard(detach('PAGE'));
    expect(heard).toEqual([]);
  });

  it('stopping the setup says why, with the calls and the host, gives the error, and says nothing more', () => {
    const { watch, lines, advance, send } = setupOnSession('PAGE');
    advance(22_000);
    watch.heard(detach('PAGE'));
    const error = watch.stopSetup('Render process gone.');
    expect(error).toBe(
      "page-setup-watch: the page's target detached during its setup (Render process gone.), so nothing is left to answer it: stopped after 22 s, not at the test timeout, and the test may run once more on a fresh browser",
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^page-setup-watch: worker 3: page setup stopped after 22 s: the page's target detached during its setup \(Render process gone\.\)/);
    expect(lines[0]).toContain('no answer to Runtime.runIfWaitingForDebugger (22.0 s), Page.enable (22.0 s)');
    expect(lines[0]).toContain('load 27.3 of 16');
    expect(lines[0]).toMatch(/the test may run once more, on a fresh browser$/);
    expect(watch.said()).toEqual(lines);
    send(4, 'Target.closeTarget');
    advance(120_000);
    expect(lines).toHaveLength(1);
  });

  it('closes the setup when the browser is closed, whose call has an id below zero', () => {
    const { lines, advance, send } = watchOnAClock();
    send(1, 'Target.createTarget');
    advance(1000);
    send(-9999, 'Browser.close');
    advance(120_000);
    expect(lines).toEqual([]);
  });
});

describe('PageSetupWatch: what may run again', () => {
  const dispatch = (method: string, params: Record<string, unknown>) => ({ method: '__dispatch__', params: { method, params } });
  const testEnd = (testId: string) => dispatch('testEnd', { testId, status: 'failed', hasNonRetriableError: false, errors: [] });

  function stoppedIn(testId: string) {
    const { watch, send } = watchOnAClock();
    watch.toRunner(dispatch('testBegin', { testId }));
    send(1, 'Target.createTarget');
    watch.stopSetup('Render process gone.');
    return watch;
  }

  it('a test that failed on its own is marked not to be retried, so the config\'s retry never reaches it', () => {
    const { watch } = watchOnAClock();
    watch.toRunner(dispatch('testBegin', { testId: 'own-assertion' }));
    expect(watch.toRunner(testEnd('own-assertion'))).toEqual(dispatch('testEnd', { testId: 'own-assertion', status: 'failed', hasNonRetriableError: true, errors: [] }));
  });

  it('a test whose setup the watch stopped is left to be retried, once', () => {
    const watch = stoppedIn('stopped');
    expect(watch.toRunner(testEnd('stopped'))).toEqual(testEnd('stopped'));
    watch.toRunner(dispatch('testBegin', { testId: 'stopped' }));
    expect((watch.toRunner(testEnd('stopped')) as ReturnType<typeof testEnd>).params.params.hasNonRetriableError).toBe(true);
  });

  it('a stop belongs to the test it happened in, not the next one', () => {
    const watch = stoppedIn('stopped');
    watch.toRunner(testEnd('stopped'));
    watch.toRunner(dispatch('testBegin', { testId: 'next' }));
    expect((watch.toRunner(testEnd('next')) as ReturnType<typeof testEnd>).params.params.hasNonRetriableError).toBe(true);
  });

  it('passes every other message as it came', () => {
    const { watch } = watchOnAClock();
    for (const message of [{ method: '__heartbeat__' }, dispatch('stepBegin', { testId: 'a' }), { method: '__dispatch__', params: { id: 4, result: {} } }, undefined]) {
      expect(watch.toRunner(message)).toBe(message);
    }
  });
});

// The watch leans on Playwright's insides in three places; this says which moved, when one does.
describe('Playwright 1.63, as the watch uses it', () => {
  const read = (file: string) => readFileSync(path.join(process.cwd(), 'node_modules', file), 'utf-8');

  it('a worker tells the runner about a test end with hasNonRetriableError, through process.send', () => {
    const worker = read('playwright/lib/worker/workerProcessEntry.js');
    expect(worker).toContain('this.dispatchEvent("testBegin", buildTestBeginPayload(testInfo))');
    expect(worker).toContain('this.dispatchEvent("testEnd", buildTestEndPayload(testInfo))');
    expect(worker).toContain('hasNonRetriableError: testInfo._hasNonRetriableError');
    const common = read('playwright/lib/common/index.js');
    expect(common).toContain('sendMessageToParent({ method: "__dispatch__", params: response })');
    expect(common).toContain('process.send(message)');
    expect(read('playwright/lib/runner/index.js')).toContain('if (this._failedWithNonRetriableError.has(failedTest))');
  });

  it("a new page waits on waitForInitializedOrError, and a Chromium page's session id sits where the watch reads it", () => {
    const core = read('playwright-core/lib/coreBundle.js');
    expect(core).toContain('const pageOrError = await progress2.race(page.waitForInitializedOrError());');
    expect(core).toContain('this._mainFrameSession = new FrameSession(this, client, targetId, null);');
    expect(core).toContain('this._sessionId = sessionId;');
    expect(core).not.toContain('"Inspector.detached"');
  });
});

describe('playwright.config.ts', () => {
  const source = readFileSync(path.join(process.cwd(), 'playwright.config.ts'), 'utf-8');

  it('starts the watch in the workers only, where the browsers are', () => {
    expect(source).toMatch(/TEST_WORKER_INDEX !== undefined[^\n]*startPageSetupWatch\(\)/);
  });

  it('gives one retry, which the watch keeps for the setups it stopped', () => {
    expect(source).toMatch(/^ {2}retries: 1,$/m);
  });
});

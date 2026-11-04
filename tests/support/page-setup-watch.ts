// tests/support/page-setup-watch.ts — mw-gq6.936: a gate:shots test hung 2 minutes 'while setting up "page"', on the Desktop,
// one per run, and the gate log said no more than that: the trace went with the worktree, and a trace of a page that never
// came has nothing in it. So each Playwright worker listens to its own browser's protocol, cheaply, and when a context or
// page is still not set up at 30 s it puts one line in the run's output (so in the kept gate log): the calls with no answer,
// what the browser last said, the state of the browser's processes, and the host's load and memory.
//
// mw-gq6.946: and when the page's own target detaches while it is being set up ('Render process gone.': its renderer
// ended and Chrome could not say how), nothing is left to answer the setup, and Playwright 1.63 does not hear it: it waits
// the whole test timeout. So the watch ends that setup at once, with a line saying why, and the test is run once more
// on a fresh browser (the config's one retry, which the watch keeps for these stops alone).
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { availableParallelism } from 'node:os';

export interface HostReading {
  load?: number;
  cores?: number;
  availableGb?: number;
  totalGb?: number;
  swapUsedGb?: number;
  /** /proc/pressure/memory 'full avg10': the share of the last 10 s every task stood waiting on memory (%). */
  memoryFull?: number;
  /** The browser's process tree, each 'pid state kind': T is stopped, D is waiting on the disk (swap), Z is dead. */
  processes?: string;
}

interface WatchOptions {
  worker: string;
  now: () => number;
  readHost: (browserPid: number | undefined) => HostReading;
  say: (line: string) => void;
}

/** When to speak about a setup still open, from its start (ms). The second tells whether anything moved; the shots budget is 120 s. */
const SPEAK_AT_MS = [30_000, 100_000];
const OPENS_SETUP = new Set(['Target.createBrowserContext', 'Target.createTarget']);
const TAKES_DOWN = new Set(['Target.closeTarget', 'Target.disposeBrowserContext', 'Browser.close']);
const MOST_CALLS_NAMED = 8;
const SEND = /SEND ► \{"id":(-?\d+),"method":"([^"]+)"/;
const REPLY = /◀ RECV \{"id":(-?\d+),/;
const EVENT = /◀ RECV \{"method":"([^"]+)"/;
// Not anchored on 'pw:browser ': when the run's output is a terminal, debug puts a colour code between the two.
const LAUNCHED = /pw:browser.*<launched> pid=(\d+)/;
const EXITED = /pw:browser.*\[pid=(\d+)\] <process did exit/;
const BROWSER_SAID = /pw:browser.*\[pid=\d+\]\[(?:err|out)\] (.*)/;
const SESSION = /"sessionId":"([^"]+)"/;
const REASON = /"reason":"([^"]*)"/;
/** The call that only a page's own session gets in a setup, so its session is the page's. */
const PAGE_CALL = 'Page.enable';
/** How many detached sessions the watch remembers: a setup asks about its own within seconds. */
const MOST_DETACHES_KEPT = 32;

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`;
}

export class PageSetupWatch {
  private readonly options: WatchOptions;
  private openedAt: number | undefined;
  private spoken = 0;
  private readonly unanswered = new Map<number, { method: string; at: number }>();
  private lastHeard: { at: number; what: string } | undefined;
  /** The live browsers this worker launched, newest last: a spec may launch its own beside the worker's. */
  private readonly pids: number[] = [];
  private browserWords: string | undefined;
  /** The page sessions of the open setup, the sessions Chrome detached (with its reason), and who waits on a detach. */
  private readonly pageSessions = new Set<string>();
  private readonly detached = new Map<string, string>();
  private readonly detachWaiters = new Map<string, Set<(reason: string) => void>>();
  /** The test the worker is running, and the tests whose setup the watch stopped: only those may run again. */
  private currentTest: string | undefined;
  private readonly stoppedTests = new Set<string>();
  private readonly lines: string[] = [];

  constructor(options: WatchOptions) {
    this.options = options;
  }

  /** One line of Playwright's debug log. A screencast frame is megabytes, so only its head is read. */
  heard(line: string): void {
    const head = line.slice(0, 200);
    const send = SEND.exec(head);
    if (send) return this.sent(Number(send[1]), send[2], SESSION.exec(head)?.[1]);
    const reply = REPLY.exec(head);
    if (reply) {
      const id = Number(reply[1]);
      const call = this.unanswered.get(id);
      this.unanswered.delete(id);
      this.lastHeard = { at: this.options.now(), what: call ? `reply to ${call.method}` : 'a reply' };
      return;
    }
    const event = EVENT.exec(head);
    if (event) {
      this.lastHeard = { at: this.options.now(), what: event[1] };
      if (event[1] === 'Inspector.detached') this.targetDetached(SESSION.exec(head)?.[1], REASON.exec(head)?.[1] ?? 'no reason given');
      return;
    }
    const launched = LAUNCHED.exec(head);
    if (launched) this.pids.push(Number(launched[1]));
    const exited = EXITED.exec(head);
    if (exited && this.pids.includes(Number(exited[1]))) this.pids.splice(this.pids.indexOf(Number(exited[1])), 1);
    const said = BROWSER_SAID.exec(head);
    if (said) this.browserWords = said[1].trim();
  }

  private sent(id: number, method: string, sessionId: string | undefined): void {
    const now = this.options.now();
    if (this.openedAt !== undefined && method === PAGE_CALL && sessionId) this.pageSessions.add(sessionId);
    if (this.openedAt !== undefined && method === 'Page.navigate') return this.close(`went through after ${Math.round((now - this.openedAt) / 1000)} s`);
    if (this.openedAt !== undefined && TAKES_DOWN.has(method)) return this.close(`ended unfinished after ${Math.round((now - this.openedAt) / 1000)} s`);
    if (this.openedAt === undefined && OPENS_SETUP.has(method)) {
      this.openedAt = now;
      this.spoken = 0;
      this.unanswered.clear();
    }
    if (this.openedAt !== undefined) this.unanswered.set(id, { method, at: now });
  }

  private close(outcome: string): void {
    if (this.spoken > 0) this.say(`page-setup-watch: worker ${this.options.worker}: page setup ${outcome}`);
    this.openedAt = undefined;
    this.spoken = 0;
    this.unanswered.clear();
    this.pageSessions.clear();
  }

  private say(line: string): void {
    this.lines.push(line);
    this.options.say(line);
  }

  /** What the watch has said in this worker, oldest first. */
  said(): string[] {
    return [...this.lines];
  }

  private targetDetached(sessionId: string | undefined, reason: string): void {
    if (!sessionId) return;
    this.lastHeard = { at: this.options.now(), what: `Inspector.detached (${reason}) from ${this.pageSessions.has(sessionId) ? 'the page' : 'another target'}` };
    this.detached.set(sessionId, reason);
    if (this.detached.size > MOST_DETACHES_KEPT) this.detached.delete(this.detached.keys().next().value!);
    for (const waiter of this.detachWaiters.get(sessionId) ?? []) waiter(reason);
    this.detachWaiters.delete(sessionId);
  }

  /** Calls `onDetach` with Chrome's reason when the session's target detaches (at once if it has); returns the way to stop listening. */
  whenDetached(sessionId: string, onDetach: (reason: string) => void): () => void {
    const reason = this.detached.get(sessionId);
    if (reason !== undefined) {
      onDetach(reason);
      return () => {};
    }
    const waiters = this.detachWaiters.get(sessionId) ?? new Set();
    waiters.add(onDetach);
    this.detachWaiters.set(sessionId, waiters);
    return () => {
      waiters.delete(onDetach);
      if (waiters.size === 0) this.detachWaiters.delete(sessionId);
    };
  }

  /** Ends the open setup because the page's target detached: says the line, keeps the test for its one retry, and gives the error. */
  stopSetup(reason: string): string {
    const age = this.openedAt === undefined ? 0 : Math.round((this.options.now() - this.openedAt) / 1000);
    const why = `the page's target detached during its setup (${reason}), so nothing is left to answer it`;
    this.say(`page-setup-watch: worker ${this.options.worker}: page setup stopped after ${age} s: ${why}; ${this.parts().join('; ')}; the test may run once more, on a fresh browser`);
    if (this.currentTest) this.stoppedTests.add(this.currentTest);
    this.openedAt = undefined;
    this.spoken = 0;
    this.unanswered.clear();
    this.pageSessions.clear();
    return `page-setup-watch: ${why}: stopped after ${age} s, not at the test timeout, and the test may run once more on a fresh browser`;
  }

  /**
   * A message from this worker to the runner, on its way: notes the test that begins, and marks every test end the watch did
   * not stop as not to be retried, so the config's one retry is for a stopped setup alone. Shapes from Playwright 1.63
   * (common/index.js sendMessageToParent, worker/workerProcessEntry.js buildTestEndPayload); a unit test reads them there.
   */
  toRunner(message: unknown): unknown {
    const dispatched = (message as { method?: string; params?: { method?: string; params?: { testId?: string } } } | undefined);
    if (dispatched?.method !== '__dispatch__') return message;
    const event = dispatched.params;
    const testId = event?.params?.testId;
    if (event?.method === 'testBegin') this.currentTest = testId;
    if (event?.method !== 'testEnd' || testId === undefined) return message;
    if (this.currentTest === testId) this.currentTest = undefined;
    if (this.stoppedTests.delete(testId)) return message;
    return { ...dispatched, params: { ...event, params: { ...event.params, hasNonRetriableError: true } } };
  }

  /** The clock's turn: speaks when an open setup reaches the next time to speak. */
  check(): void {
    if (this.openedAt === undefined || this.spoken >= SPEAK_AT_MS.length) return;
    if (this.options.now() - this.openedAt < SPEAK_AT_MS[this.spoken]) return;
    this.spoken++;
    this.say(this.describe());
  }

  browserPid(): number | undefined {
    return this.pids[this.pids.length - 1];
  }

  /** The calls of the open setup that have no answer yet. */
  waitingOn(): string[] {
    return [...this.unanswered.values()].map((call) => call.method);
  }

  /** The line: what the open setup is waiting on, right now. */
  describe(): string {
    const age = this.openedAt === undefined ? 0 : Math.round((this.options.now() - this.openedAt) / 1000);
    return `page-setup-watch: worker ${this.options.worker}: page setup ${age} s old: ${this.parts().join('; ')}`;
  }

  /** The calls with no answer, what the browser last said, the host and the browser's processes. */
  private parts(): string[] {
    const now = this.options.now();
    const calls = [...this.unanswered.values()];
    const named = calls.slice(0, MOST_CALLS_NAMED).map((call) => `${call.method} (${seconds(now - call.at)})`);
    if (calls.length > MOST_CALLS_NAMED) named.push(`and ${calls.length - MOST_CALLS_NAMED} more`);
    const parts = [
      calls.length > 0 ? `no answer to ${named.join(', ')}` : 'every call has its answer',
      this.lastHeard ? `last from the browser ${seconds(now - this.lastHeard.at)} ago: ${this.lastHeard.what}` : 'nothing from the browser yet',
    ];
    if (this.browserWords) parts.push(`browser said: ${this.browserWords}`);
    const host = this.options.readHost(this.browserPid());
    const hostParts = [
      host.load !== undefined && `load ${host.load} of ${host.cores}`,
      host.availableGb !== undefined && `memory ${host.availableGb} of ${host.totalGb} GB free`,
      host.swapUsedGb !== undefined && `swap ${host.swapUsedGb} GB used`,
      host.memoryFull !== undefined && `memory pressure full ${host.memoryFull}`,
    ].filter(Boolean);
    if (hostParts.length > 0) parts.push(`host: ${hostParts.join(', ')}`);
    if (host.processes) parts.push(`processes: ${host.processes}`);
    return parts;
  }
}

function gb(kb: number): number {
  return Math.round((kb / 1024 / 1024) * 10) / 10;
}

function browserProcesses(browserPid: number): string {
  const children = new Map<number, number[]>();
  const states = new Map<number, string>();
  for (const name of readdirSync('/proc')) {
    if (!/^\d+$/.test(name)) continue;
    try {
      // pid (comm) state ppid: comm may hold spaces and brackets, so read after its last ')'.
      const stat = readFileSync(`/proc/${name}/stat`, 'utf8');
      const [state, ppid] = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
      states.set(Number(name), state);
      children.set(Number(ppid), [...(children.get(Number(ppid)) ?? []), Number(name)]);
    } catch {
      // gone since readdir
    }
  }
  const tree: string[] = [];
  const visit = (pid: number) => {
    if (!states.has(pid)) return;
    let kind = 'browser';
    try {
      kind = /--type=([\w-]+)/.exec(readFileSync(`/proc/${pid}/cmdline`, 'utf8'))?.[1] ?? kind;
    } catch {
      // gone since the scan
    }
    tree.push(`${pid} ${states.get(pid)} ${kind}`);
    (children.get(pid) ?? []).forEach(visit);
  };
  visit(browserPid);
  return tree.length > 0 ? tree.join(', ') : `${browserPid} is gone`;
}

/** The host's state now, from /proc; what a host does not have (pressure, on some kernels) is left out. */
export function readHost(browserPid: number | undefined): HostReading {
  const reading: HostReading = {};
  try {
    reading.load = Number(readFileSync('/proc/loadavg', 'utf8').split(' ')[0]);
    reading.cores = availableParallelism();
    const meminfo = readFileSync('/proc/meminfo', 'utf8');
    const kb = (field: string) => Number(new RegExp(`^${field}:\\s+(\\d+)`, 'm').exec(meminfo)?.[1] ?? 0);
    reading.availableGb = gb(kb('MemAvailable'));
    reading.totalGb = gb(kb('MemTotal'));
    reading.swapUsedGb = gb(kb('SwapTotal') - kb('SwapFree'));
    const full = /^full avg10=([\d.]+)/m.exec(readFileSync('/proc/pressure/memory', 'utf8'));
    if (full) reading.memoryFull = Number(full[1]);
  } catch {
    // not Linux, or no pressure file: the line says what it could read
  }
  try {
    if (browserPid !== undefined) reading.processes = browserProcesses(browserPid);
  } catch {
    // as above
  }
  return reading;
}

const THIS_WORKER = Symbol.for('postern.pageSetupWatch');
type WithWatch = typeof globalThis & { [THIS_WORKER]?: PageSetupWatch };

/** This worker's watch, once playwright.config.ts has started it. */
export function pageSetupWatch(): PageSetupWatch | undefined {
  return (globalThis as WithWatch)[THIS_WORKER];
}

/** The debug package inside Playwright, the only place its protocol can be heard from; a spec fails if it moves. */
interface PlaywrightDebug {
  log: (...args: unknown[]) => void;
  enable: (namespaces: string) => void;
  enabled: (name: string) => boolean;
}

/** The page class inside Playwright's server, and the session of a Chromium page; a spec fails if they move. */
interface ServerPage {
  delegate?: { _mainFrameSession?: { _client?: { _sessionId?: unknown } } };
  initializedOrUndefined(): unknown;
  waitForInitializedOrError(): Promise<unknown>;
}

/**
 * A page's setup waits on waitForInitializedOrError, which Playwright 1.63 settles when every setup call has its answer or
 * the target is closed (Target.detachedFromTarget), never on Inspector.detached. Here it also settles, with the watch's
 * error, when the page's own session detaches first: Playwright's newPage then closes the page and throws that error.
 */
function stopSetupsWhoseTargetDetached(watch: PageSetupWatch, page: { prototype: ServerPage }): void {
  const theirs = page.prototype.waitForInitializedOrError;
  page.prototype.waitForInitializedOrError = function (this: ServerPage) {
    const initialized = theirs.call(this);
    const sessionId = this.delegate?._mainFrameSession?._client?._sessionId;
    if (typeof sessionId !== 'string' || this.initializedOrUndefined()) return initialized;
    return new Promise((resolve) => {
      const stopListening = watch.whenDetached(sessionId, (reason) => resolve(new Error(watch.stopSetup(reason))));
      void initialized.then((pageOrError) => {
        stopListening();
        resolve(pageOrError);
      });
    });
  };
}

/**
 * Called by playwright.config.ts in each worker. A person's own DEBUG still gets what it asked for. The way to the runner is
 * taken first, so a watch that cannot hear Playwright still marks every failure as not to be retried, as before mw-gq6.946.
 */
export function startPageSetupWatch(): void {
  if (pageSetupWatch()) return;
  const watch = new PageSetupWatch({
    worker: process.env.TEST_WORKER_INDEX ?? '?',
    now: Date.now,
    readHost,
    say: (line) => process.stderr.write(`${line}\n`),
  });
  const toRunner = process.send?.bind(process) as ((...args: unknown[]) => boolean) | undefined;
  if (toRunner) process.send = ((message: unknown, ...rest: unknown[]) => toRunner(watch.toRunner(message), ...rest)) as typeof process.send;
  (globalThis as WithWatch)[THIS_WORKER] = watch;
  try {
    const playwrightCore = createRequire(import.meta.url);
    const { debug } = playwrightCore('playwright-core/lib/utilsBundle') as { debug: PlaywrightDebug };
    const { server } = playwrightCore('playwright-core/lib/coreBundle') as { server: { Page: { prototype: ServerPage } } };
    const asked = { protocol: debug.enabled('pw:protocol'), browser: debug.enabled('pw:browser') };
    const theirs = debug.log;
    debug.log = function (this: unknown, ...args: unknown[]) {
      const line = String(args[0]);
      watch.heard(line);
      const ours = line.includes('pw:protocol') ? !asked.protocol : line.includes('pw:browser') && !asked.browser;
      if (!ours) theirs.apply(this, args);
    };
    debug.enable([process.env.DEBUG, 'pw:protocol', 'pw:browser'].filter(Boolean).join(','));
    stopSetupsWhoseTargetDetached(watch, server.Page);
    setInterval(() => watch.check(), 5000).unref();
  } catch (error) {
    process.stderr.write(`page-setup-watch: not started: ${String(error)}\n`);
  }
}

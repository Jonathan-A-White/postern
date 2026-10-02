// docs/research/battery-measure/measure.spec.ts — mw-f758y.39: what Postern does while it is idle.
// Not part of the gate. Unlocks the app against the e2e stub backend (tests/e2e/cockpit-stub.ts), with
// a real SSE endpoint standing in for GET /api/events (25 s pings, held open like the Go backend's),
// then sits on one screen for MEASURE_SECONDS (default 60) and records:
//   - CPU time of every browser process (CDP SystemInfo.getProcessInfo) and the page's own
//     TaskDuration/ScriptDuration (Performance.getMetrics);
//   - a sampling CPU profile of the page (Profiler), reduced to its busiest functions;
//   - every network request, by path; main-thread long tasks (> 50 ms); timer schedulings and firings by call site;
//   - frames drawn in a 15 s trace taken after the measurement.
// Results go to docs/research/battery-measure/results/<label>.json.
import { test, expect, type Page, type CDPSession } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrivateKey } from '@bsv/sdk';
import { createMnemonic, deriveMasterKey } from '../../../src/services/vault';
import { encryptMessage } from '../../../src/services/messages';
import { encodeTurn } from '../../../src/services/talk';
import { MAYOR } from '../../../tests/support/cockpit-fixture';
import { seedVault, stubBackend } from '../../../tests/e2e/cockpit-stub';

test.use({ serviceWorkers: 'block' });

const SECONDS = Number(process.env.MEASURE_SECONDS ?? 60);
const FRAME_SECONDS = 15;
const OUT = join(dirname(fileURLToPath(import.meta.url)), 'results');

/** GET /api/events as the Go backend serves it: a hello, then a ": ping" comment every 25 s, for as long as the client stays. */
async function sseServer(): Promise<{ server: Server; port: number; opened: () => number; message: () => void }> {
  let connections = 0;
  const clients = new Set<import('node:http').ServerResponse>();
  const server = createServer((req, res) => {
    if (!req.url?.startsWith('/api/events')) {
      res.writeHead(404).end();
      return;
    }
    connections += 1;
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*' });
    res.write('event: hello\ndata: {"head": 0}\n\n');
    clients.add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
    req.on('close', () => {
      clearInterval(ping);
      clients.delete(res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return { server, port: typeof address === 'object' && address ? address.port : 0, opened: () => connections, message: () => clients.forEach((res) => res.write('event: message\ndata: {}\n\n')) };
}

interface Sample {
  type: string;
  id: number;
  cpuTime: number;
}

async function processCpu(browser: CDPSession): Promise<Sample[]> {
  const info = (await browser.send('SystemInfo.getProcessInfo' as never)) as { processInfo: Sample[] };
  return info.processInfo;
}

function cpuDelta(before: Sample[], after: Sample[]): Record<string, number> {
  const start = new Map(before.map((p) => [p.id, p.cpuTime]));
  const total: Record<string, number> = {};
  for (const p of after) total[p.type] = (total[p.type] ?? 0) + (p.cpuTime - (start.get(p.id) ?? 0));
  return total;
}

/** The profile's self time per function, as a share of the sampled time (idle and program included). */
function reduceProfile(profile: { nodes: Array<{ id: number; callFrame: { functionName: string; url: string; lineNumber: number }; }>; samples: number[]; timeDeltas: number[] }) {
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const self = new Map<string, number>();
  let total = 0;
  profile.samples.forEach((id, i) => {
    const dt = profile.timeDeltas[i + 1] ?? profile.timeDeltas[i] ?? 0;
    const frame = byId.get(id)?.callFrame;
    const name = frame ? `${frame.functionName || '(anonymous)'} ${frame.url.split('/').pop() ?? ''}:${frame.lineNumber + 1}`.trim() : '?';
    self.set(name, (self.get(name) ?? 0) + dt);
    total += dt;
  });
  const idle = [...self.entries()].filter(([k]) => k.startsWith('(idle)')).reduce((a, [, v]) => a + v, 0);
  const busy = [...self.entries()].filter(([k]) => !k.startsWith('(idle)') && !k.startsWith('(root)'));
  const busyMs = busy.reduce((a, [, v]) => a + v, 0) / 1000;
  return {
    sampledMs: Math.round(total / 1000),
    idleMs: Math.round(idle / 1000),
    busyMs: Math.round(busyMs * 10) / 10,
    top: busy.sort((a, b) => b[1] - a[1]).slice(0, 12).map(([name, us]) => ({ name, ms: Math.round(us / 100) / 10 })),
  };
}

interface Options {
  label: string;
  route: string;
  /** Hold and release one turn first, so a talk is open when the idle starts. */
  openTalk?: boolean;
  /** Turn the CSS animations off (the pulsing live dot). */
  noAnimation?: boolean;
  /** Replace the silent loop's Audio with a stub that never plays. */
  noSilentLoop?: boolean;
  /** Every /api call fails (the home is down): the phone falls back to reading the anchor address from WhatsOnChain (docs/protocol.md §21). */
  backendDown?: boolean;
  /** A talk from three days ago that he never ended is on the phone's disk: does opening the Talk screen take the wake lock? */
  staleTalk?: boolean;
  /** Measure `seconds` (not SECONDS) and, at the start, tell the app it is back on screen (visibilitychange): the burst of work a return to the foreground makes. */
  foreground?: boolean;
  seconds?: number;
  /** Pretend the page is hidden (visibilityState) for the whole idle: shows what the page's own code does for a hidden page. */
  hidden?: boolean;
}

async function installFakes(page: Page, options: Options): Promise<void> {
  await page.addInitScript((opts) => {
    const define = (target: object, name: string, value: unknown) => Object.defineProperty(target, name, { value, configurable: true, writable: true });
    class Recognizer {
      static active: Recognizer | undefined;
      lang = '';
      continuous = false;
      interimResults = false;
      onaudiostart?: () => void;
      onresult?: (event: unknown) => void;
      onend?: () => void;
      start() {
        Recognizer.active = this;
        setTimeout(() => this.onaudiostart?.(), 0);
      }
      stop() {
        setTimeout(() => this.onend?.(), 0);
      }
      abort() {}
    }
    define(window, 'SpeechRecognition', Recognizer);
    define(window, 'webkitSpeechRecognition', Recognizer);
    (window as unknown as { __hear: (t: string) => void }).__hear = (text) => Recognizer.active?.onresult?.({ results: [[{ transcript: text }]] });
    define(window, 'speechSynthesis', {
      speak: (u: { onend?: () => void }) => setTimeout(() => u.onend?.(), 50),
      cancel: () => undefined,
      getVoices: () => [],
    });
    define(crypto, 'randomUUID', () => 'talk-measure');
    const locks = { requested: 0, released: 0 };
    (window as unknown as { __locks: typeof locks }).__locks = locks;
    define(navigator, 'wakeLock', {
      request: async () => {
        locks.requested += 1;
        return { release: async () => void (locks.released += 1) };
      },
    });
    if (opts.noSilentLoop) {
      define(window, 'Audio', function FakeAudio() {
        return { play: async () => undefined, pause: () => undefined, loop: false };
      });
    }
    if (opts.hidden) {
      define(document, 'visibilityState', 'hidden');
      define(document, 'hidden', true);
    }
    // Timers: how many were scheduled and how many fired, by the function that scheduled them.
    const timers: Record<string, { kind: string; scheduled: number; fired: number; every?: number }> = {};
    (window as unknown as { __timers: typeof timers }).__timers = timers;
    const site = () => {
      const lines = (new Error().stack ?? '').split('\n').slice(3, 5);
      return lines.map((l) => l.trim().replace(/^at /, '').replace(/http:\/\/[^/]+\/assets\//, '')).join(' < ');
    };
    const wrap = (name: 'setTimeout' | 'setInterval') => {
      const original = window[name].bind(window) as (h: TimerHandler, ms?: number, ...args: unknown[]) => number;
      define(window, name, (handler: TimerHandler, ms?: number, ...args: unknown[]) => {
        if (typeof handler !== 'function') return original(handler, ms, ...args);
        const key = `${name} ${ms ?? 0}ms ${site()}`;
        const entry = (timers[key] ??= { kind: name, scheduled: 0, fired: 0, every: ms });
        entry.scheduled += 1;
        return original(() => {
          entry.fired += 1;
          return (handler as (...a: unknown[]) => unknown)(...args);
        }, ms);
      });
    };
    wrap('setTimeout');
    wrap('setInterval');
    // IndexedDB transactions (Dexie's liveQuery, the outbox, the 15 s drain), by mode and store.
    const idb: Record<string, number> = {};
    (window as unknown as { __idb: typeof idb }).__idb = idb;
    const transaction = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (this: IDBDatabase, stores: string | string[], mode?: IDBTransactionMode, options?: IDBTransactionOptions) {
      const key = `${mode ?? 'readonly'} ${[stores].flat().join(',')}`;
      idb[key] = (idb[key] ?? 0) + 1;
      return transaction.call(this, stores, mode, options);
    } as typeof IDBDatabase.prototype.transaction;
    // Media elements that were told to play (the silent loop is one, made with new Audio and never put on the page).
    const played = { calls: 0 };
    (window as unknown as { __played: typeof played }).__played = played;
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      played.calls += 1;
      return play.call(this);
    };
    let frames = 0;
    const raf = window.requestAnimationFrame.bind(window);
    define(window, 'requestAnimationFrame', (cb: FrameRequestCallback) => raf((t) => ((frames += 1), cb(t))));
    (window as unknown as { __raf: () => number }).__raf = () => frames;
    // Long tasks
    const long: Array<{ start: number; duration: number }> = [];
    (window as unknown as { __long: typeof long }).__long = long;
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) long.push({ start: Math.round(e.startTime), duration: Math.round(e.duration) });
      }).observe({ type: 'longtask', buffered: true });
    } catch {
      // no long-task support
    }
  }, options);
  if (options.noAnimation) await page.addStyleTag({ content: '*,*::before,*::after{animation:none !important;transition:none !important}' }).catch(() => undefined);
}

async function run(page: Page, browserCdp: CDPSession, options: Options, tracing: () => Promise<number | undefined>): Promise<void> {
  const sse = await sseServer();
  const cleanups: Array<() => void> = [];
  try {
    const mnemonic = createMnemonic();
    const governor = PrivateKey.fromHex(Buffer.from(await deriveMasterKey(mnemonic)).toString('hex'));
    const { posted } = await stubBackend(page, governor);
    // His one turn and the Mayor's answer to it, for the open-talk scenario.
    const answerRecord = () => ({
      seq: 1000,
      txid: `direct:${'d'.repeat(64)}`,
      vout: 0,
      payload: {
        ...encryptMessage({ text: encodeTurn({ talk: { id: 'talk-measure', turn: 1 }, text: 'Three things landed.', role: 'answer', model: 'sonnet' }), class: 'talk', senderPrivateKeyHex: MAYOR.toHex(), recipientPublicKeyHex: governor.toPublicKey().toString() }),
        ts: Math.floor(Date.now() / 1000),
      },
    });
    const seal = (text: string, role: 'turn' | 'answer', mine: boolean, ts: number) => ({
      ...encryptMessage({ text: encodeTurn({ talk: { id: 'talk-stale', turn: 1 }, text, role }), class: 'talk', senderPrivateKeyHex: mine ? governor.toHex() : MAYOR.toHex(), recipientPublicKeyHex: mine ? MAYOR.toPublicKey().toString() : governor.toPublicKey().toString() }),
      ts,
    });
    const threeDaysAgo = Math.floor(Date.now() / 1000) - 3 * 86_400;
    const stale = [
      { seq: 2000, txid: `direct:${'a'.repeat(64)}`, vout: 0, payload: seal('What landed?', 'turn', true, threeDaysAgo) },
      { seq: 2001, txid: `direct:${'b'.repeat(64)}`, vout: 0, payload: seal('Three things.', 'answer', false, threeDaysAgo + 5) },
    ];
    await page.route('**/api/messages**', async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      const since = Number(new URL(route.request().url()).searchParams.get('since') ?? 0);
      if (options.staleTalk && since < 2000) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ records: stale, next: 2001 }) });
      const records = options.openTalk && posted.length > 0 && since < 1000 ? [answerRecord()] : [];
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ records, next: records.length ? 1000 : since }) });
    });
    await page.route('**/api/presence', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ mayor: false }) }));
    await page.route('**/api/events', (route) => route.continue({ url: `http://127.0.0.1:${sse.port}/api/events` }));

    // The backend tells the phone a record has landed once his turn is posted, as it does for the Mayor's answer.
    let told = false;
    const teller = setInterval(() => {
      if (!told && posted.length > 0) {
        told = true;
        setTimeout(sse.message, 500);
      }
    }, 200);
    cleanups.push(() => clearInterval(teller));
    await installFakes(page, options);
    await seedVault(page, mnemonic);
    await page.goto('/');
    await page.getByLabel('Recovery phrase').fill(mnemonic);
    await page.getByRole('button', { name: 'Unlock' }).click();
    await expect(page.getByRole('heading', { name: 'Needs you' })).toBeVisible();
    if (options.backendDown) {
      await page.route('**/api.whatsonchain.com/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
      await page.route('**/api/**', (route) => route.abort('connectionrefused'));
    }
    await page.waitForTimeout(2_000); // the first sync stores its rows before the page is loaded again
    await page.goto(options.route);
    if (options.noAnimation) await page.addStyleTag({ content: '*,*::before,*::after{animation:none !important;transition:none !important}' });

    if (options.openTalk) {
      const button = page.getByRole('button', { name: 'Hold to talk' });
      await expect(button).toBeEnabled();
      const box = (await button.boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await expect(page.getByRole('button', { name: 'Release to send' })).toBeVisible();
      await page.evaluate(() => (window as unknown as { __hear: (t: string) => void }).__hear('What landed today?'));
      await page.mouse.up();
      await expect(page.getByTestId('talk-answer')).toContainText('Three things landed.', { timeout: 20_000 });
      // the answer has been spoken; the talk stays open until he ends it
      await expect(page.getByRole('button', { name: 'End talk' })).toBeVisible();
    }
    await page.waitForTimeout(5_000); // the first syncs settle

    // ---- the measured stretch ----
    const requests: Record<string, number> = {};
    const onRequest = (request: { url(): string }) => {
      const url = new URL(request.url());
      const name = url.hostname.includes('whatsonchain') ? `WhatsOnChain ${url.pathname.replace(/\/address\/[^/]+/, '/address/…')}` : url.pathname;
      if (!url.pathname.startsWith('/api/') && !url.hostname.includes('whatsonchain')) return;
      requests[name.replace(/\/utxos\/.*/, '/utxos/…')] = (requests[name.replace(/\/utxos\/.*/, '/utxos/…')] ?? 0) + 1;
    };
    page.on('request', onRequest);
    await page.evaluate(() => {
      const w = window as unknown as { __timers: Record<string, { scheduled: number; fired: number }>; __long: unknown[] };
      for (const t of Object.values(w.__timers)) {
        t.scheduled = 0;
        t.fired = 0;
      }
      w.__long.length = 0;
      for (const k of Object.keys((window as unknown as { __idb: object }).__idb)) delete (window as unknown as { __idb: Record<string, number> }).__idb[k];
    });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Performance.enable');
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: 1000 });
    const metric = async (): Promise<Record<string, number>> => Object.fromEntries(((await cdp.send('Performance.getMetrics')) as { metrics: Array<{ name: string; value: number }> }).metrics.map((m) => [m.name, m.value]));
    const rafBefore = await page.evaluate(() => (window as unknown as { __raf: () => number }).__raf());
    const load = loadavg();
    const cpuBefore = await processCpu(browserCdp);
    const before = await metric();
    await cdp.send('Profiler.start');
    const startedAt = Date.now();
    if (options.foreground) await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await page.waitForTimeout((options.seconds ?? SECONDS) * 1000);
    const wall = (Date.now() - startedAt) / 1000;
    const { profile } = (await cdp.send('Profiler.stop')) as { profile: Parameters<typeof reduceProfile>[0] };
    const after = await metric();
    const cpuAfter = await processCpu(browserCdp);
    page.off('request', onRequest);
    const rafAfter = await page.evaluate(() => (window as unknown as { __raf: () => number }).__raf());
    const page_ = await page.evaluate(() => {
      const w = window as unknown as { __timers: Record<string, { kind: string; scheduled: number; fired: number; every?: number }>; __long: Array<{ start: number; duration: number }>; __locks: { requested: number; released: number } };
      return { timers: Object.entries(w.__timers).filter(([, t]) => t.fired > 0 || t.scheduled > 0).sort((a, b) => b[1].fired - a[1].fired).map(([site, t]) => ({ site, fired: t.fired, scheduled: t.scheduled })), long: w.__long, locks: w.__locks, idb: (window as unknown as { __idb: Record<string, number> }).__idb, hidden: document.hidden, played: (window as unknown as { __played: { calls: number } }).__played.calls };
    });

    const delta = (name: string) => (after[name] ?? 0) - (before[name] ?? 0);
    const cpu = cpuDelta(cpuBefore, cpuAfter);
    const frames = options.seconds ? undefined : await tracing();
    const perMinute = (n: number) => Math.round((n * 60) / wall * 10) / 10;
    const result = {
      label: options.label,
      route: options.route,
      options,
      wallSeconds: Math.round(wall * 10) / 10,
      hostLoadAvg1m: Math.round(load[0] * 100) / 100,
      eventStreamConnections: sse.opened(),
      requests: { total: Object.values(requests).reduce((a, b) => a + b, 0), perMinute: Object.fromEntries(Object.entries(requests).map(([k, v]) => [k, perMinute(v)])), raw: requests },
      cpuSecondsByProcess: Object.fromEntries(Object.entries(cpu).map(([k, v]) => [k, Math.round(v * 1000) / 1000])),
      cpuPercentOfOneCore: Object.fromEntries(Object.entries(cpu).map(([k, v]) => [k, Math.round((v / wall) * 1000) / 10])),
      page: {
        taskSeconds: Math.round(delta('TaskDuration') * 1000) / 1000,
        scriptSeconds: Math.round(delta('ScriptDuration') * 1000) / 1000,
        layoutSeconds: Math.round(delta('LayoutDuration') * 1000) / 1000,
        recalcStyleSeconds: Math.round(delta('RecalcStyleDuration') * 1000) / 1000,
        layoutCount: delta('LayoutCount'),
        recalcStyleCount: delta('RecalcStyleCount'),
        jsHeapUsedMB: Math.round(((after.JSHeapUsedSize ?? 0) / 1048576) * 10) / 10,
        jsHeapGrowthKB: Math.round(delta('JSHeapUsedSize') / 1024),
        domNodes: after.Nodes,
        domNodeGrowth: delta('Nodes'),
        eventListeners: after.JSEventListeners,
        eventListenerGrowth: delta('JSEventListeners'),
        rafCallbacks: rafAfter - rafBefore,
      },
      longTasks: { count: page_.long.length, list: page_.long.slice(0, 20) },
      timers: page_.timers.slice(0, 25),
      indexedDbTransactionsPerMinute: Object.fromEntries(Object.entries(page_.idb).map(([k, v]) => [k, perMinute(v)])),
      wakeLocks: page_.locks,
      mediaPlayCalls: page_.played,
      pageHidden: page_.hidden,
      profile: reduceProfile(profile),
      framesDrawnIn15s: frames,
    };
    mkdirSync(OUT, { recursive: true });
    writeFileSync(join(OUT, `${options.label}.json`), JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ ...result, timers: undefined, profile: { ...result.profile, top: result.profile.top.slice(0, 5) } }, null, 1));
  } finally {
    cleanups.forEach((fn) => fn());
    sse.server.closeAllConnections?.();
    sse.server.close();
  }
}

const SCENARIOS: Options[] = [
  { label: 'channels-idle', route: '/?v=talk' },
  { label: 'talk-idle', route: '/?v=line' },
  { label: 'talk-open-idle', route: '/?v=line', openTalk: true },
  { label: 'channels-idle-no-animation', route: '/?v=talk', noAnimation: true },
  { label: 'talk-open-idle-no-silent-loop', route: '/?v=line', openTalk: true, noSilentLoop: true },
  { label: 'channels-backend-down', route: '/?v=talk', backendDown: true },
  { label: 'channels-foreground-burst', route: '/?v=talk', foreground: true, seconds: 8 },
  { label: 'talk-stale-open', route: '/?v=line', staleTalk: true, seconds: 8 },
  { label: 'talk-open-idle-hidden', route: '/?v=line', openTalk: true, hidden: true },
];

for (const scenario of SCENARIOS) {
  test(`idle: ${scenario.label}`, async ({ page, browser }) => {
    const browserCdp = await browser.newBrowserCDPSession();
    const tracing = async (): Promise<number | undefined> => {
      try {
        await browser.startTracing(page, { categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline.frame'], screenshots: false });
        await page.waitForTimeout(FRAME_SECONDS * 1000);
        const trace = JSON.parse((await browser.stopTracing()).toString()) as { traceEvents: Array<{ name: string }> };
        return trace.traceEvents.filter((e) => e.name === 'DrawFrame' || e.name === 'Commit').length;
      } catch {
        return undefined;
      }
    };
    await run(page, browserCdp, scenario, tracing);
  });
}

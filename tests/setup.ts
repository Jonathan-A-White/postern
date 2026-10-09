import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
// Not '@testing-library/react': importing it here would register its auto-unmount before
// the step files' dont-cleanup-after-each import can switch that off.
import { configure } from '@testing-library/dom';

// waitFor/findBy default to 1 s, which the landing gate's loaded host outruns
// (mw-gq6.204, .199, .205). vitest's testTimeout (20 s) stays well above this.
configure({ asyncUtilTimeout: 5000 });

// jsdom does not play media: the Talk line's silent loop (src/services/silentLoop.ts) calls these.
if (typeof HTMLMediaElement !== 'undefined') {
  HTMLMediaElement.prototype.play = () => Promise.resolve();
  HTMLMediaElement.prototype.pause = () => undefined;
}

// The Key screen's WhatsOnChain reads space themselves 350 ms apart (src/services/chainPacer.ts); a
// test file is a fresh page with no waiting. Only chainPacer is imported here: a setup file that
// imported sharedChainReads would load spell-forge-bsv before a test file's vi.mock of it.
import { beforeAll } from 'vitest';
import { setChainReadGapMs } from '../src/services/chainPacer';

beforeAll(() => {
  setChainReadGapMs(0);
});

// What the cockpit's hooks remember between mounts (src/cockpit/lastKnown.ts) is one test's phone, not
// the next's. A feature scenario is one phone across its steps, each its own test (vitest-cucumber): it is
// forgotten at the start of a test and at a scenario's Given, and kept through its When, Then and And.
import { beforeEach } from 'vitest';
import { forgetLastKnown } from '../src/cockpit/lastKnown';

beforeEach(({ task }) => {
  if (!/^(When|Then|And|But) /.test(task.name)) forgetLastKnown();
});

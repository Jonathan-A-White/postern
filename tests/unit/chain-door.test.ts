// src/chain.ts is the one door the services reach the chain through (mw-e6e8f2.2): a second
// implementation plugged in with setChain carries a post, and the lint rule refuses a direct import.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ESLint } from 'eslint';
import { PrivateKey, Utils } from '@bsv/sdk';
import { chain, setChain, type Chain } from '../../src/chain';
import { deliver, settledWrites } from '../../src/services/deliver';
import { db } from '../../src/data/db';

const KEY = new Uint8Array(Utils.toArray('45'.repeat(32), 'hex'));
const MAYOR = PrivateKey.fromHex('77'.repeat(32)).toPublicKey().toString();

function fakeChain(sent: string[]): Chain {
  return {
    ...chain,
    sendText: vi.fn(async (params) => {
      sent.push(params.text);
      return 'f'.repeat(64);
    }),
  };
}

let restore: Chain | undefined;

afterEach(async () => {
  if (restore) setChain(restore);
  restore = undefined;
  vi.unstubAllGlobals();
  await settledWrites();
  await db.messages.clear();
});

describe('a second chain plugged in with setChain', () => {
  it('returns the chain that was in use, and carries a post made while the backend is unreachable', async () => {
    const sent: string[] = [];
    const fake = fakeChain(sent);
    const previous = setChain(fake);
    restore = previous;
    expect(previous).not.toBe(fake);
    const requested: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      requested.push(String(input));
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    vi.stubGlobal('fetch', fetchImpl);

    const delivered = await deliver('hello', 'message', { key: KEY, mayorKey: MAYOR, direct: true, fetchImpl });

    expect(delivered).toEqual({ txid: 'f'.repeat(64), channel: 'chain' });
    expect(sent).toEqual(['hello']);
    expect(requested.some((url) => url.includes('whatsonchain'))).toBe(false);
  });

  it('is the one setChain gives back next time', () => {
    const first = fakeChain([]);
    const second = fakeChain([]);
    const original = setChain(first);
    expect(setChain(second)).toBe(first);
    expect(setChain(original)).toBe(second);
  });
});

describe('the lint rule on the chain modules', () => {
  const eslint = new ESLint();
  const snippet = "import { broadcastThroughWhatsOnChain } from './whatsonchain';\nexport const f = broadcastThroughWhatsOnChain;\n";
  const messagesFor = async (filePath: string, code = snippet) => {
    const [result] = await eslint.lintText(code, { filePath });
    return result.messages.filter((message) => message.ruleId === 'no-restricted-imports');
  };

  it('refuses a direct chain import from deliver.ts, live.ts and attachments.ts', async () => {
    for (const file of ['deliver', 'live', 'attachments', 'outbox']) {
      expect(await messagesFor(`src/services/${file}.ts`)).toHaveLength(1);
    }
  });

  it('refuses each chain module, not just whatsonchain', async () => {
    for (const mod of ['send', 'spendable', 'chainRead', 'confirmedHistory', 'stamp', 'licence', 'mint', 'issue']) {
      expect(await messagesFor('src/services/deliver.ts', `import * as m from './${mod}';\nexport { m };\n`)).toHaveLength(1);
    }
  });

  it('lets the chain modules themselves, and src/chain.ts, import one another', async () => {
    expect(await messagesFor('src/services/chainRead.ts')).toHaveLength(0);
    expect(await messagesFor('src/services/spendable.ts')).toHaveLength(0);
    expect(await messagesFor('src/chain.ts', snippet.replace('./whatsonchain', './services/whatsonchain'))).toHaveLength(0);
  });
});

describe('the lint rule on the screens', () => {
  const eslint = new ESLint();
  const messagesFor = async (filePath: string, code: string) => {
    const [result] = await eslint.lintText(code, { filePath });
    return result.messages.filter((message) => message.ruleId === 'no-restricted-imports');
  };

  it('refuses a chain module from src/key/KeyVault.tsx, and from any other file under src outside the chain files', async () => {
    const snippet = "import { mintMyLicence } from '../services/mint';\nexport const f = mintMyLicence;\n";
    expect(await messagesFor('src/key/KeyVault.tsx', snippet)).toHaveLength(1);
    expect(await messagesFor('src/cockpit/BeadScreen.tsx', "import { verifyStamp } from '../services/stamp';\nexport const f = verifyStamp;\n")).toHaveLength(1);
    expect(await messagesFor('src/model/talkLine.ts', snippet)).toHaveLength(1);
  });

  it('does not mistake the cockpit send module for the chain one, and lets the chain-only components through', async () => {
    expect(await messagesFor('src/cockpit/MapScreen.tsx', "import { sendAction } from './send';\nexport const f = sendAction;\n")).toHaveLength(0);
    const snippet = "import { mintCostSatoshis } from '../services/mint';\nexport const f = mintCostSatoshis;\n";
    for (const file of ['src/key/IssueLicences.tsx', 'src/licence/LicenceExplainer.tsx', 'src/cockpit/StampSection.tsx']) {
      expect(await messagesFor(file, snippet)).toHaveLength(0);
    }
  });
});

// docs/fixtures/contract.json is Postern's wire contract; the PWA's lists must equal it.
import { describe, expect, it } from 'vitest';
import contract from '../../docs/fixtures/contract.json';
import { MESSAGE_CLASS_LIST, PHONELESS_CLASSES, WIRE_CLASSES } from '../../src/data/db';
import { ACTION_WORDS } from '../../src/model/conversation';
import { EXPECT_STATES } from '../../src/model/cards';
import { EVENT_KINDS } from '../../src/model/events';
import { NEED_KINDS } from '../../src/model/view';

const sorted = (list: readonly string[]): string[] => [...list].sort();

describe('the contract fixture', () => {
  it.each([
    ['message_classes', WIRE_CLASSES],
    ['event_kinds', EVENT_KINDS],
    ['expect_states', EXPECT_STATES],
    ['need_kinds', NEED_KINDS],
    ['action_words', ACTION_WORDS],
  ] as const)('%s is the same list in the PWA and in the fixture', (name, ours) => {
    const theirs = (contract as Record<string, unknown>)[name];
    expect(Array.isArray(theirs), `${name} is a list in contract.json`).toBe(true);
    expect(new Set(theirs as string[]).size, `${name} repeats a value in contract.json`).toBe((theirs as string[]).length);
    expect(new Set(ours).size, `${name} repeats a value in the PWA`).toBe(ours.length);
    expect(sorted(ours), `${name}: the PWA and docs/fixtures/contract.json differ`).toEqual(sorted(theirs as string[]));
  });
});

describe('the grist class (§19)', () => {
  it('is a wire class the phone never stores: the PWA keeps it out of MessageClass on purpose', () => {
    expect(WIRE_CLASSES).toContain('grist');
    expect(PHONELESS_CLASSES).toContain('grist');
    expect(MESSAGE_CLASS_LIST as readonly string[]).not.toContain('grist');
  });
});

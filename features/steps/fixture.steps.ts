// features/steps/fixture.steps.ts — runs features/fixture.feature under vitest via
// @amiceli/vitest-cucumber. Exercises scripts/generate-fixture.ts, the generator
// docs/protocol.md §5 names as the source of docs/fixtures/protocol-vectors.json.
import { readFileSync } from 'node:fs';
import { expect } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { buildFixture, serializeFixture, FIXTURE_PATH, type ProtocolFixture } from '../../scripts/generate-fixture';

const feature = await loadFeature('features/fixture.feature');

describeFeature(feature, ({ Scenario }) => {
  Scenario("AC-1: the generator produces every section the Go port needs", ({ Given, Then, And }) => {
    let fixture: ProtocolFixture;

    Given('the fixture generator runs', async () => {
      fixture = await buildFixture();
    });

    Then('the fixture names the fixed inputs', () => {
      expect(fixture.inputs.senderPrivateKeyHex).toMatch(/^[0-9a-f]{64}$/);
      expect(fixture.inputs.recipientPrivateKeyHex).toMatch(/^[0-9a-f]{64}$/);
      expect(fixture.inputs.plaintext.length).toBeGreaterThan(0);
      expect(fixture.inputs.utxo).toEqual({
        txid: 'f'.repeat(64),
        vout: 0,
        satoshis: 100_000,
        script: expect.any(String),
      });
    });

    And('the fixture names the encryptMessage output', () => {
      expect(fixture.encryptMessage.kind).toBe('msg');
      expect(fixture.encryptMessage.ct).toEqual(expect.any(String));
    });

    And('the fixture names the record script hex', () => {
      expect(fixture.recordScriptHex).toMatch(/^[0-9a-f]+$/);
    });

    And("the fixture names the signed transaction's raw hex and txid", () => {
      expect(fixture.transaction.rawtxHex).toMatch(/^[0-9a-f]+$/);
      expect(fixture.transaction.txid).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  Scenario('AC-2: the committed fixture matches a fresh run byte-for-byte', ({ Given, When, Then }) => {
    let committed: string;
    let regenerated: string;

    Given('the committed fixture file', () => {
      committed = readFileSync(FIXTURE_PATH, 'utf-8');
    });

    When('the generator runs again', async () => {
      regenerated = serializeFixture(await buildFixture());
    });

    Then('its serialized output is identical to the committed file', () => {
      expect(regenerated).toBe(committed);
    });
  });

  Scenario('AC-3: protocol.md names the fixture path and generator', ({ Given, Then, And }) => {
    let protocolDoc: string;

    Given('docs/protocol.md', () => {
      protocolDoc = readFileSync('docs/protocol.md', 'utf-8');
    });

    Then('it names the committed fixture path', () => {
      expect(protocolDoc).toContain('docs/fixtures/protocol-vectors.json');
    });

    And('it names the generator script', () => {
      expect(protocolDoc).toContain('scripts/generate-fixture.ts');
    });
  });
});

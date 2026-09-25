// features/steps/docs-consistency.steps.ts — runs features/docs-consistency.feature
// under vitest via @amiceli/vitest-cucumber. Guards against docs/api.md's example
// payload drifting from docs/protocol.md §1, the normative envelope (mw-1589l.16).
import { readFileSync } from 'node:fs';
import { expect } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';

function jsonBlockAfter(markdown: string, afterHeading: string, beforeHeading?: string): unknown {
  const start = markdown.indexOf(afterHeading);
  if (start === -1) {
    throw new Error(`heading not found: ${afterHeading}`);
  }
  const end = beforeHeading ? markdown.indexOf(beforeHeading, start) : -1;
  const section = end === -1 ? markdown.slice(start) : markdown.slice(start, end);
  const match = section.match(/```json\n([\s\S]*?)```/);
  if (!match) {
    throw new Error(`no json code block found after ${afterHeading}`);
  }
  return JSON.parse(match[1]);
}

function bulletTextFor(markdown: string, field: string): string {
  const marker = `- \`${field}\``;
  const start = markdown.indexOf(marker);
  if (start === -1) {
    throw new Error(`no bullet found for ${field}`);
  }
  const end = markdown.indexOf('\n- `', start + marker.length);
  return end === -1 ? markdown.slice(start) : markdown.slice(start, end);
}

const feature = await loadFeature('features/docs-consistency.feature');

describeFeature(feature, ({ Scenario }) => {
  Scenario("AC-1: api.md's message payload example matches protocol.md §1 exactly", ({ Given, And, Then }) => {
    let protocolEnvelope: Record<string, unknown>;
    let apiPayload: Record<string, unknown>;

    Given("docs/protocol.md's §1 envelope example", () => {
      const protocolDoc = readFileSync('docs/protocol.md', 'utf-8');
      protocolEnvelope = jsonBlockAfter(protocolDoc, '## 1. The record payload', '## 2. Encryption') as Record<
        string,
        unknown
      >;
    });

    And("docs/api.md's message record example", () => {
      const apiDoc = readFileSync('docs/api.md', 'utf-8');
      const records = jsonBlockAfter(apiDoc, '## GET /api/messages', '## POST /api/broadcast') as {
        records: Array<{ payload: Record<string, unknown> }>;
      };
      apiPayload = records.records[0].payload;
    });

    Then("api.md's payload has exactly the same fields as protocol.md's envelope", () => {
      expect(Object.keys(apiPayload).sort()).toEqual(Object.keys(protocolEnvelope).sort());
    });
  });

  Scenario('AC-2: api.md names protocol.md as the source of truth for the payload shape', ({ Given, Then }) => {
    let payloadBullet: string;

    Given("docs/api.md's payload description", () => {
      const apiDoc = readFileSync('docs/api.md', 'utf-8');
      payloadBullet = bulletTextFor(apiDoc, 'payload');
    });

    Then('it points to docs/protocol.md as the source of truth', () => {
      expect(payloadBullet).toContain('docs/protocol.md');
    });
  });
});

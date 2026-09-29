// src/model/hands.ts — a step only the Governor's hands could take, as the app
// shows it and approves it (docs/protocol.md §17): the exact text that will run,
// the canonical bytes that text is hashed as, and the string his approval signs.
// The Go side (millwright's mw and mw-hands-root) computes the same bytes, so an
// approval binds exactly what he saw.

export interface HandsStep {
  id: string;
  host: string;
  /** "user" or "root". */
  as: string;
  run: string;
  way_back: string;
  sha256: string;
  /** `why` is the reason a step failed, when the Mayor's host gave one. */
  ran?: { at: string; exit: number; host: string; why?: string };
}

const encoder = new TextEncoder();

function field(value: string): string {
  return `${encoder.encode(value).length}:${value}\n`;
}

/** §17's canonical bytes: a version line, then each field as `<byte length>:<text>\n`. */
export function canonicalStep(bead: string, step: Pick<HandsStep, 'id' | 'host' | 'as' | 'run' | 'way_back'>): string {
  return `hands/v1\n${field(bead)}${field(step.id)}${field(step.host)}${field(step.as)}${field(step.run)}${field(step.way_back)}`;
}

export async function stepSha256(bead: string, step: Pick<HandsStep, 'id' | 'host' | 'as' | 'run' | 'way_back'>): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(canonicalStep(bead, step)));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** What his approval signs: the step's hash and the moment he approved it. */
export function approvalMessage(sha256: string, approvedAt: number): string {
  return `hands-approve/v1\n${sha256}\n${approvedAt}\n`;
}

export function decodeHandsSteps(value: unknown): HandsStep[] {
  if (!Array.isArray(value)) return [];
  const out: HandsStep[] = [];
  for (const item of value) {
    if (typeof item !== 'object' || item === null) continue;
    const raw = item as Record<string, unknown>;
    if (typeof raw.id !== 'string' || typeof raw.run !== 'string' || typeof raw.sha256 !== 'string') continue;
    const ran = typeof raw.ran === 'object' && raw.ran !== null ? (raw.ran as Record<string, unknown>) : undefined;
    out.push({
      id: raw.id,
      host: typeof raw.host === 'string' ? raw.host : '',
      as: raw.as === 'root' ? 'root' : 'user',
      run: raw.run,
      way_back: typeof raw.way_back === 'string' ? raw.way_back : '',
      sha256: raw.sha256,
      ...(ran && typeof ran.exit === 'number'
        ? {
            ran: {
              at: typeof ran.at === 'string' ? ran.at : '',
              exit: ran.exit,
              host: typeof ran.host === 'string' ? ran.host : '',
              ...(typeof ran.why === 'string' && ran.why !== '' ? { why: ran.why } : {}),
            },
          }
        : {}),
    });
  }
  return out;
}

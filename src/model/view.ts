// src/model/view.ts — the live view (docs/protocol.md §11) and one bead's
// detail (§12) as typed data: decoding what the Mayor's host wrote, and turning
// an old backend's §7 snapshot into the same shape so the cockpit has one model
// whichever backend it is talking to.
import type { Snapshot } from '../services/questions';
import { decodeHandsSteps, type HandsStep } from './hands';

export type NeedKind = 'question' | 'approve' | 'verify' | 'stale' | 'demo' | 'hands' | 'alarm';

export const NEED_KINDS: NeedKind[] = ['question', 'approve', 'verify', 'stale', 'demo', 'hands', 'alarm'];

export interface BeadPath {
  rig: string;
  branch: string;
  host: string;
  model: string;
  effort: string;
  formula: string;
  harness: string;
}

export interface ViewBead {
  id: string;
  title: string;
  type: string;
  status: string;
  priority: number;
  parent?: string;
  labels: string[];
  assignee: string;
  waits: string[];
  created: string;
  updated: string;
  started: string;
  closed: string;
  path?: BeadPath;
  attempts: number;
  summary: string;
  comments: number;
  done_earlier: number;
}

export interface Need {
  kind: NeedKind;
  bead: string;
  epic: string;
  title: string;
  since: string;
  text: string;
  recommended: string;
  options: string[];
  blocks: number;
  /** docs/protocol.md §17: a `hands` need's steps he can approve and run from here. */
  steps: HandsStep[];
}

export interface HostState {
  name: string;
  last_sync: string;
}

export interface View {
  v: 2;
  written_at: string;
  host: string;
  hosts: HostState[];
  needs: Need[];
  beads: ViewBead[];
}

export interface BeadComment {
  at: string;
  author: string;
  text: string;
}

export interface BeadDetail {
  v: 2;
  id: string;
  title: string;
  type: string;
  status: string;
  priority: number;
  parent?: string;
  labels: string[];
  assignee: string;
  waits: string[];
  blocks: string[];
  children: string[];
  created: string;
  updated: string;
  started: string;
  closed: string;
  path?: BeadPath;
  attempts: number;
  description: string;
  acceptance: string;
  comments: BeadComment[];
}

const EMPTY_VIEW: View = { v: 2, written_at: '', host: '', hosts: [], needs: [], beads: [] };

export function emptyView(): View {
  return { ...EMPTY_VIEW, hosts: [], needs: [], beads: [] };
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function decodePath(value: unknown): BeadPath | undefined {
  const raw = record(value);
  if (!raw) return undefined;
  const path: BeadPath = {
    rig: str(raw.rig),
    branch: str(raw.branch),
    host: str(raw.host),
    model: str(raw.model),
    effort: str(raw.effort),
    formula: str(raw.formula),
    harness: str(raw.harness),
  };
  return Object.values(path).some((field) => field !== '') ? path : undefined;
}

function priorityNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const match = value.match(/^P?(\d)$/i);
    if (match) return Number(match[1]);
  }
  return 2;
}

function decodeBead(value: unknown): ViewBead | undefined {
  const raw = record(value);
  if (!raw || typeof raw.id !== 'string' || raw.id === '') return undefined;
  const parent = str(raw.parent);
  return {
    id: raw.id,
    title: str(raw.title) || raw.id,
    type: str(raw.type) || 'task',
    status: str(raw.status) || 'open',
    priority: priorityNumber(raw.priority),
    ...(parent ? { parent } : {}),
    labels: strings(raw.labels),
    assignee: str(raw.assignee),
    waits: strings(raw.waits),
    created: str(raw.created),
    updated: str(raw.updated),
    started: str(raw.started),
    closed: str(raw.closed),
    path: decodePath(raw.path),
    attempts: num(raw.attempts),
    summary: str(raw.summary),
    comments: num(raw.comments),
    done_earlier: num(raw.done_earlier),
  };
}

function decodeNeed(value: unknown): Need | undefined {
  const raw = record(value);
  if (!raw) return undefined;
  const kind = str(raw.kind) as NeedKind;
  if (!NEED_KINDS.includes(kind)) return undefined;
  return {
    kind,
    bead: str(raw.bead),
    epic: str(raw.epic),
    title: str(raw.title),
    since: str(raw.since),
    text: str(raw.text),
    recommended: str(raw.recommended),
    options: strings(raw.options),
    blocks: num(raw.blocks),
    steps: decodeHandsSteps(raw.steps),
  };
}

/** Parses a decrypted §11 plaintext. Anything that is not a v2 view is refused
 * with an error saying so; unknown fields are ignored and missing ones take
 * safe empty values, so a slightly newer or older producer never blanks the app. */
export function decodeView(text: string): View {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('The view is not JSON.');
  }
  const raw = record(parsed);
  if (!raw || raw.v !== 2) throw new Error('The view is not a version 2 view.');
  const hosts = Array.isArray(raw.hosts)
    ? raw.hosts
        .map((host) => record(host))
        .filter((host): host is Record<string, unknown> => host !== undefined && typeof host.name === 'string')
        .map((host) => ({ name: str(host.name), last_sync: str(host.last_sync) }))
    : [];
  return {
    v: 2,
    written_at: str(raw.written_at),
    host: str(raw.host),
    hosts,
    needs: Array.isArray(raw.needs) ? raw.needs.map(decodeNeed).filter((need): need is Need => need !== undefined) : [],
    beads: Array.isArray(raw.beads) ? raw.beads.map(decodeBead).filter((bead): bead is ViewBead => bead !== undefined) : [],
  };
}

/** Parses a decrypted §12 plaintext. */
export function decodeBeadDetail(text: string): BeadDetail {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('The bead detail is not JSON.');
  }
  const raw = record(parsed);
  const bead = decodeBead(parsed);
  if (!raw || !bead) throw new Error('The bead detail names no bead.');
  const comments = Array.isArray(raw.comments)
    ? raw.comments
        .map((comment) => record(comment))
        .filter((comment): comment is Record<string, unknown> => comment !== undefined)
        .map((comment) => ({ at: str(comment.at), author: str(comment.author), text: str(comment.text) }))
    : [];
  return {
    v: 2,
    id: bead.id,
    title: bead.title,
    type: bead.type,
    status: bead.status,
    priority: bead.priority,
    ...(bead.parent ? { parent: bead.parent } : {}),
    labels: bead.labels,
    assignee: bead.assignee,
    waits: bead.waits,
    blocks: strings(raw.blocks),
    children: strings(raw.children),
    created: bead.created,
    updated: bead.updated,
    started: bead.started,
    closed: bead.closed,
    path: bead.path,
    attempts: bead.attempts,
    description: str(raw.description),
    acceptance: str(raw.acceptance),
    comments,
  };
}

function blankBead(id: string, title: string): ViewBead {
  return {
    id,
    title,
    type: 'task',
    status: 'open',
    priority: 2,
    labels: [],
    assignee: '',
    waits: [],
    created: '',
    updated: '',
    started: '',
    closed: '',
    attempts: 0,
    summary: '',
    comments: 0,
    done_earlier: 0,
  };
}

function firstLine(text: string | undefined, limit = 280): string {
  if (!text) return '';
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > limit ? `${clean.slice(0, limit - 1)}…` : clean;
}

/** An old backend's §7 snapshot, as the same model: its epics as epic beads,
 * their three buckets as child beads, open questions as `question` needs and
 * the last day's landings as `verify` needs. What §7 never carried (held and
 * blocked beads, dependencies between epics, paths) is simply absent. */
export function viewFromSnapshot(snapshot: Snapshot): View {
  const beads: ViewBead[] = [];
  const needs: Need[] = [];
  const seen = new Set<string>();
  const add = (bead: ViewBead) => {
    if (seen.has(bead.id)) {
      const index = beads.findIndex((existing) => existing.id === bead.id);
      beads[index] = { ...beads[index], ...bead };
      return;
    }
    seen.add(bead.id);
    beads.push(bead);
  };

  for (const epic of snapshot.epics) {
    add({
      ...blankBead(epic.id, epic.title),
      type: 'epic',
      status: epic.status || 'open',
      priority: priorityNumber(epic.priority),
      done_earlier: Math.max(0, epic.closed_count - epic.landed.length),
    });
    for (const item of epic.working) {
      add({
        ...blankBead(item.id, item.title),
        parent: epic.id,
        status: item.status || 'open',
        priority: priorityNumber(item.priority),
        updated: item.updated_at,
        waits: item.waits ?? [],
        summary: firstLine(item.description),
        comments: item.comments?.length ?? 0,
      });
    }
    for (const item of epic.landed) {
      add({
        ...blankBead(item.id, item.title),
        parent: epic.id,
        status: 'closed',
        closed: item.landed_at,
        updated: item.landed_at,
        summary: firstLine(item.description),
        comments: item.comments?.length ?? 0,
      });
      needs.push({
        kind: 'verify',
        bead: item.id,
        epic: epic.id,
        title: item.title,
        since: item.landed_at,
        text: '',
        recommended: '',
        options: ['Verified'],
        blocks: 0,
        steps: [],
      });
    }
    for (const item of epic.needs_you) {
      if (!seen.has(item.id)) {
        add({
          ...blankBead(item.id, item.title),
          parent: epic.id,
          summary: firstLine(item.description),
          comments: item.comments?.length ?? 0,
        });
      }
      needs.push({
        kind: 'question',
        bead: item.id,
        epic: epic.id,
        title: item.title,
        since: item.asked_at,
        text: item.title,
        recommended: item.recommended,
        options: item.options,
        blocks: 0,
        steps: [],
      });
    }
  }

  needs.sort((a, b) => (a.kind === b.kind ? a.since.localeCompare(b.since) : a.kind === 'question' ? -1 : 1));
  return { v: 2, written_at: snapshot.written_at, host: '', hosts: [], needs, beads };
}

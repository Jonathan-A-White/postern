// src/markdown/beadLinks.ts — mw-tbx1n.11: a remark step that turns a bead id
// (mw-<base36>, optional .N parts) in plain text into a link to its page in the app.
// Only text nodes are touched: inline code and fenced blocks are other node types,
// and the children of a link are skipped, so an id there stays as it was written.
import type { Link, Nodes, Parent, PhrasingContent, Root, RootContent, Text } from 'mdast';
import { beadHref } from '../nav/route';

const BEAD_ID = /mw-[a-z0-9]+(?:\.\d+)*(?![A-Za-z0-9_-])/g;
const WORD_CHAR = /[A-Za-z0-9_\-/.]/;

function linkIds(node: Text): PhrasingContent[] | null {
  const parts: PhrasingContent[] = [];
  const { value } = node;
  let last = 0;
  for (const match of value.matchAll(BEAD_ID)) {
    const start = match.index;
    if (start > 0 && WORD_CHAR.test(value[start - 1])) continue;
    if (start > last) parts.push({ type: 'text', value: value.slice(last, start) });
    const link: Link = { type: 'link', url: beadHref(match[0]), children: [{ type: 'text', value: match[0] }] };
    parts.push(link);
    last = start + match[0].length;
  }
  if (parts.length === 0) return null;
  if (last < value.length) parts.push({ type: 'text', value: value.slice(last) });
  return parts;
}

function walk(node: Nodes): void {
  if (node.type === 'link' || node.type === 'linkReference' || !('children' in node)) return;
  const parent = node as Parent;
  parent.children = parent.children.flatMap((child): RootContent[] => {
    if (child.type === 'text') return linkIds(child) ?? [child];
    walk(child);
    return [child];
  });
}

export function remarkBeadLinks() {
  return (tree: Root): void => walk(tree);
}

// src/markdown/readable.ts — Markdown as the text he reads, line for line (mw-gq6.252), for
// what leaves the app through Share: paragraphs and list items stay lines, a code block keeps
// its lines exactly, and the marks (emphasis, heading hashes, link targets, fences) go.
// markdownToPlain is the one-line sibling for previews.
import { FENCE, RULE, inlineToPlain } from './plain';

const LIST_ITEM = /^(\s*)(?:[-*+]|(\d+[.)]))\s+/;
const QUOTE = /^\s*(?:>\s*)+/;
const HEADING = /^\s*#{1,6}\s+/;

export function markdownToReadable(text: string): string {
  const lines: string[] = [];
  let fence: { mark: string; diagram: boolean } | undefined;
  for (const line of text.split(/\r?\n/)) {
    if (fence) {
      const close = FENCE.exec(line);
      if (close && close[1][0] === fence.mark[0] && close[1].length >= fence.mark.length && !close[2]) fence = undefined;
      else if (!fence.diagram) lines.push(line);
      continue;
    }
    const open = FENCE.exec(line);
    if (open) {
      const diagram = open[2].toLowerCase() === 'mermaid';
      fence = { mark: open[1], diagram };
      if (diagram) lines.push('[diagram]');
      continue;
    }
    if (RULE.test(line)) continue;
    let rest = line.replace(QUOTE, '').replace(HEADING, '');
    const item = LIST_ITEM.exec(rest);
    if (item) rest = `${item[1]}${item[2] ?? '-'} ${rest.slice(item[0].length)}`;
    lines.push(inlineToPlain(rest).trimEnd());
  }
  // One blank line at most between paragraphs, none at either end.
  return lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+|\s+$/g, '');
}

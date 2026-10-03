// src/markdown/plain.ts — Markdown as one line of plain text (mw-hy6f4.6), for the
// places that show a message as a preview rather than render it: the Talk and Needs
// rows, search, notifications, read-aloud. A string, so nothing in a row can nest an
// anchor; a mermaid block is '[diagram]' since a line cannot draw it.

export const FENCE = /^\s*(`{3,}|~{3,})\s*([^\s`]*)/;
const LINE_PREFIX = /^\s*(?:>\s*)*(?:#{1,6}\s+|[-*+]\s+|\d+[.)]\s+)?/;
export const RULE = /^\s*(?:[-*_]\s*){3,}$/;
const CODE_SPAN = /(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g;
const IMAGE = /!\[([^\]]*)\]\((?:[^()\s]|\([^()\s]*\))*(?:\s+"[^"]*")?\)/g;
const LINK = /\[([^\]]+)\]\((?:[^()\s]|\([^()\s]*\))*(?:\s+"[^"]*")?\)/g;
const AUTOLINK = /<((?:https?|mailto):[^<>\s]+)>/g;
const STRIKE = /~~(?=\S)([\s\S]*?\S)~~/g;
const EMPHASIS = /(?<![\w*])(\*{1,3})(?=[^\s*])([^*]*?[^\s*])\1(?![\w*])/g;
const UNDERSCORE = /(?<![\w_])(_{1,3})(?=[^\s_])([^_]*?[^\s_])\1(?![\w_])/g;

export function inlineToPlain(line: string): string {
  const code: string[] = [];
  let out = line.replace(CODE_SPAN, (_m, _ticks: string, body: string) => {
    code.push(body.trim());
    return `\uE000${code.length - 1}\uE000`;
  });
  out = out.replace(IMAGE, '$1').replace(LINK, '$1').replace(AUTOLINK, '$1');
  out = out.replace(STRIKE, '$1').replace(EMPHASIS, '$2').replace(UNDERSCORE, '$2');
  return out.replace(/\uE000(\d+)\uE000/g, (_m, i: string) => code[Number(i)]);
}

export function markdownToPlain(text: string): string {
  const pieces: string[] = [];
  let fence: { mark: string; diagram: boolean } | undefined;
  for (const line of text.split(/\r?\n/)) {
    if (fence) {
      const close = FENCE.exec(line);
      if (close && close[1][0] === fence.mark[0] && close[1].length >= fence.mark.length && !close[2]) fence = undefined;
      else if (!fence.diagram) pieces.push(line);
      continue;
    }
    const open = FENCE.exec(line);
    if (open) {
      const diagram = open[2].toLowerCase() === 'mermaid';
      fence = { mark: open[1], diagram };
      if (diagram) pieces.push('[diagram]');
      continue;
    }
    if (RULE.test(line)) continue;
    pieces.push(inlineToPlain(line.replace(LINE_PREFIX, '')));
  }
  return pieces.join(' ').replace(/\s+/g, ' ').trim();
}

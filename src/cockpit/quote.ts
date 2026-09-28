// src/cockpit/quote.ts — what he quotes rides at the top of what he sends
// (plans/0021 decision 10: talk about one comment), as a Markdown quote naming who
// said it.
export function quoteBlock(quote: { speaker: string; text: string }): string {
  const lines = quote.text.trim().split('\n').slice(0, 6).join('\n');
  const clipped = lines.length > 400 ? `${lines.slice(0, 399)}…` : lines;
  return `${clipped
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n')}\n> — ${quote.speaker}\n\n`;
}

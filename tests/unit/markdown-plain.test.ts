// mw-hy6f4.6: Markdown as one line of plain text, for list previews.
import { describe, it, expect } from 'vitest';
import { markdownToPlain } from '../../src/markdown/plain';

describe('markdownToPlain', () => {
  it('drops emphasis markers and the backticks round inline code', () => {
    expect(markdownToPlain('**bold** and `code`')).toBe('bold and code');
    expect(markdownToPlain('*a* _b_ __c__ ~~d~~')).toBe('a b c d');
  });

  it('shows a link as its text and an autolink as its URL', () => {
    expect(markdownToPlain('[the bead](https://x/y)')).toBe('the bead');
    expect(markdownToPlain('see <https://x.example/y> now')).toBe('see https://x.example/y now');
  });

  it('drops heading hashes, blockquote marks and list markers, and joins the lines', () => {
    expect(markdownToPlain('# Title\n- one\n- two')).toBe('Title one two');
    expect(markdownToPlain('> quoted\n\n1. first\n2. second\n* third\n+ fourth')).toBe('quoted first second third fourth');
  });

  it('puts [diagram] where a mermaid block was, and other fences give their inner text', () => {
    expect(markdownToPlain('Before\n```mermaid\ngraph TD\nA-->B\n```\nAfter')).toBe('Before [diagram] After');
    expect(markdownToPlain('Run:\n```sh\nnpm test\n```')).toBe('Run: npm test');
  });

  it('leaves plain text alone, collapsing runs of whitespace', () => {
    expect(markdownToPlain('just some words')).toBe('just some words');
    expect(markdownToPlain('  spaced \n\n  out  ')).toBe('spaced out');
    expect(markdownToPlain('snake_case_name and 2*3*4')).toBe('snake_case_name and 2*3*4');
  });
});

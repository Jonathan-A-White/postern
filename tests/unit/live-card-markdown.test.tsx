// tests/unit/live-card-markdown.test.tsx — mw-debsil.1: a live card's item text goes through
// the shared Markdown component, so a web address or a bead id in it is a link as in a message.
import { render, screen, within } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { LiveCard } from '../../src/cockpit/LiveCard';
import type { LiveCard as LiveCardData, LiveCardItem } from '../../src/model/cards';

function item(n: number, text: string, extra: Partial<LiveCardItem> = {}): LiveCardItem {
  return { n, text, links: [], done: false, since: 0, ...extra };
}

function card(items: LiveCardItem[]): LiveCardData {
  return { id: 'c1', title: 'Top 5', sentAt: 0, items, subscribe: { kinds: [], beads: [] }, done: false, touchedAt: 0 };
}

const rows = () => screen.getAllByTestId('live-card-item');

describe('LiveCard item text as Markdown (mw-debsil.1)', () => {
  it('turns a web address in an item into a link that opens in a new tab', () => {
    render(<LiveCard card={card([item(1, 'Install https://example.com/x.apk on the phone')])} />);
    const link = within(rows()[0]).getByRole('link', { name: 'https://example.com/x.apk' });
    expect(link).toHaveAttribute('href', 'https://example.com/x.apk');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('turns a bead id in an item into an in-app bead link, as a message does', () => {
    render(<LiveCard card={card([item(1, 'Look at mw-gq6.222 first')])} />);
    const link = within(rows()[0]).getByRole('link', { name: 'mw-gq6.222' });
    expect(link).toHaveAttribute('href', '?v=bead&id=mw-gq6.222');
    expect(link).not.toHaveAttribute('target');
  });

  it('keeps the number for a screen reader, the text size and no paragraph spacing inside the item', () => {
    render(<LiveCard card={card([item(2, 'Plain words')])} />);
    const text = within(rows()[0]).getByTestId('live-card-item-text');
    expect(text.textContent).toBe('2. Plain words');
    expect(text.querySelector('.sr-only')?.textContent).toBe('2. ');
    expect(text.className).toContain('text-[14.5px]');
    expect(text.querySelector('.markdown')).toHaveClass('markdown-item');
  });

  it('keeps a done item muted', () => {
    render(<LiveCard card={card([item(1, 'Finished https://example.com/x.apk', { done: true, doneAt: 1 })])} />);
    expect(within(rows()[0]).getByTestId('live-card-item-text')).toHaveClass('text-muted');
  });

  it('leaves the bead links list under an item as it was, with the title or the id', () => {
    render(<LiveCard card={card([item(1, 'About mw-a.1', { links: ['mw-a.1', 'mw-b.1'] })])} titleOf={(id) => (id === 'mw-a.1' ? 'Title of a' : undefined)} />);
    const list = within(rows()[0]).getByRole('list', { name: 'Links for item 1' });
    const links = within(list).getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual(['Title of a', 'mw-b.1']);
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['?v=bead&id=mw-a.1', '?v=bead&id=mw-b.1']);
  });
});

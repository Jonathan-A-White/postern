// tests/unit/todo-lists.test.ts — mw-ev7oyy.4: the To do board's lists and cards from the view.
// The grouping helper puts open hitl:todo beads under their epic, newest list first, and skips
// closed beads and beads without the label; the Postern adapter's store gives them in todo_rank order.
import { describe, expect, it } from 'vitest';
import { indexView } from '../../src/model/tree';
import { decodeView } from '../../src/model/view';
import { beadsNamed, dayKey, groupCards, groupCounts, groupOf, openLinkLabel, openTodoCount, orderCards, shortName, todoListsFromView, TODO_LABEL, OTHER_LIST } from '../../src/todo';
import type { TodoCard } from '../../src/todo';
import { fixtureView } from '../support/cockpit-fixture';
import type { ViewBead } from '../../src/model/view';

const NOW = Date.parse('2026-10-13T12:00:00Z');
const at = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();

function bead(id: string, extra: Partial<ViewBead> = {}): ViewBead {
  return { ...fixtureView(NOW).beads[0], id, title: `Title of ${id}`, type: 'task', status: 'open', parent: undefined, labels: [], waits: [], done_earlier: 0, closed: '', created: at(60), ...extra };
}

const todo = (id: string, extra: Partial<ViewBead> = {}) => bead(id, { labels: ['hitl', TODO_LABEL], ...extra });

function listsOf(beads: ViewBead[]) {
  return todoListsFromView(indexView({ ...fixtureView(NOW), needs: [], beads }), NOW);
}

describe('the grouping helper', () => {
  it('puts hitl:todo beads under their epic, newest list first', () => {
    const lists = listsOf([
      bead('mw-old', { type: 'epic', created: at(600) }),
      bead('mw-new', { type: 'epic', created: at(30) }),
      todo('mw-old.1', { parent: 'mw-old' }),
      todo('mw-new.1', { parent: 'mw-new' }),
      todo('mw-new.2', { parent: 'mw-new' }),
    ]);
    expect(lists.map((list) => [list.id, list.title, list.cards.map((card) => card.id)])).toEqual([
      ['mw-new', 'Title of mw-new', ['mw-new.1', 'mw-new.2']],
      ['mw-old', 'Title of mw-old', ['mw-old.1']],
    ]);
  });

  it('skips closed beads and beads without the label, and an epic with nothing open on it', () => {
    const lists = listsOf([
      bead('mw-e', { type: 'epic' }),
      bead('mw-factory', { type: 'epic' }),
      todo('mw-e.1', { parent: 'mw-e' }),
      todo('mw-e.2', { parent: 'mw-e', status: 'closed', closed: at(5) }),
      bead('mw-e.3', { parent: 'mw-e', labels: ['hitl'] }),
      bead('mw-factory.1', { parent: 'mw-factory' }),
    ]);
    expect(lists.map((list) => list.id)).toEqual(['mw-e']);
    expect(lists[0].cards.map((card) => card.id)).toEqual(['mw-e.1']);
    expect(openTodoCount(indexView({ ...fixtureView(NOW), needs: [], beads: [bead('mw-e', { type: 'epic' }), todo('mw-e.1', { parent: 'mw-e' }), todo('mw-e.2', { parent: 'mw-e', status: 'closed' })] }))).toBe(1);
  });

  it('puts a bead with no epic under Other, last', () => {
    const lists = listsOf([bead('mw-e', { type: 'epic' }), todo('mw-loose'), todo('mw-e.1', { parent: 'mw-e' }), todo('mw-gone.1', { parent: 'mw-not-in-view' })]);
    expect(lists.map((list) => list.id)).toEqual(['mw-e', OTHER_LIST]);
    expect(lists[1].title).toBe('Other');
    expect(lists[1].cards.map((card) => card.id)).toEqual(['mw-gone.1', 'mw-loose']);
  });

  it('does not show a list epic labelled hitl:todo as a card of its own', () => {
    const lists = listsOf([todo('mw-e', { type: 'epic' }), todo('mw-e.1', { parent: 'mw-e' })]);
    expect(lists.map((list) => [list.id, list.cards.map((card) => card.id)])).toEqual([['mw-e', ['mw-e.1']]]);
  });
});

describe('the Postern adapter over a view', () => {
  it('gives the cards in todo_rank order, then priority, then age', () => {
    const lists = listsOf([
      bead('mw-e', { type: 'epic' }),
      todo('mw-e.late', { parent: 'mw-e', priority: 1, created: at(5) }),
      todo('mw-e.early', { parent: 'mw-e', priority: 1, created: at(50) }),
      todo('mw-e.p0', { parent: 'mw-e', priority: 0, created: at(1) }),
      todo('mw-e.r2', { parent: 'mw-e', priority: 3, todo_rank: 2 }),
      todo('mw-e.r1', { parent: 'mw-e', priority: 4, todo_rank: 1 }),
      todo('mw-e.r15', { parent: 'mw-e', todo_rank: 1.5 }),
    ]);
    expect(lists[0].cards.map((card) => card.id)).toEqual(['mw-e.r1', 'mw-e.r15', 'mw-e.r2', 'mw-e.p0', 'mw-e.early', 'mw-e.late']);
  });

  it('orders a string todo_rank as text, after the numbers and before the unranked', () => {
    const lists = listsOf([
      bead('mw-e', { type: 'epic' }),
      todo('mw-e.none', { parent: 'mw-e' }),
      todo('mw-e.b', { parent: 'mw-e', todo_rank: 'b0' }),
      todo('mw-e.a', { parent: 'mw-e', todo_rank: 'a0' }),
    ]);
    expect(lists[0].cards.map((card) => card.id)).toEqual(['mw-e.a', 'mw-e.b', 'mw-e.none']);
  });

  it('reads todo_rank from the view, as a number or a string', () => {
    const view = decodeView(JSON.stringify({ v: 2, beads: [{ id: 'mw-a', todo_rank: 3 }, { id: 'mw-b', todo_rank: 'm0' }, { id: 'mw-c', todo_rank: '' }, { id: 'mw-d' }] }));
    expect(view.beads.map((b) => b.todo_rank)).toEqual([3, 'm0', undefined, undefined]);
  });
});

describe('the due time of a card (mw-ev7oyy.9)', () => {
  it('reads todo_due from the view, and a card carries it as due', () => {
    const view = decodeView(JSON.stringify({ v: 2, beads: [{ id: 'mw-a', todo_due: '2026-10-14T09:00:00Z' }, { id: 'mw-b', todo_due: '' }, { id: 'mw-c', todo_due: 'soon' }, { id: 'mw-d' }] }));
    expect(view.beads.map((b) => b.todo_due)).toEqual(['2026-10-14T09:00:00Z', undefined, undefined, undefined]);
  });

  it('puts the due on the card of a list', () => {
    const lists = listsOf([bead('mw-e', { type: 'epic' }), todo('mw-e.1', { parent: 'mw-e', todo_due: '2026-10-14T09:00:00Z' }), todo('mw-e.2', { parent: 'mw-e' })]);
    expect(lists[0].cards.map((card) => card.due)).toEqual(['2026-10-14T09:00:00Z', undefined]);
  });
});

describe('the beads a card names', () => {
  it('lists each bead id once, in the order met, never the card itself', () => {
    expect(beadsNamed('mw-card', ['Do it after mw-aaa.1 and see mw-bbb', 'mw-aaa.1 again, `mw-code` is code too, and mw-card itself'])).toEqual(['mw-aaa.1', 'mw-bbb', 'mw-code']);
  });
});

describe('a list header is its short name (mw-ev7oyy.14 AC-4)', () => {
  const LONG = "Governor's Discipleship Institute list (Deep Discipleship, Weeks 4-6): last week's unfinished work and this week's pre-work, due at the next group meeting";

  it("cuts the epic's title at its first ' (' or ':'", () => {
    expect(shortName(LONG)).toBe("Governor's Discipleship Institute list");
    expect(shortName('Errands: the garage and the deck')).toBe('Errands');
    expect(shortName('Books (to read)')).toBe('Books');
  });

  it('leaves a title with no colon or bracket as it is', () => {
    expect(shortName('Title of mw-list')).toBe('Title of mw-list');
    expect(shortName('  Later this week  ')).toBe('Later this week');
  });

  it('does not cut a time of day, and never comes out empty', () => {
    expect(shortName('Call at 10:30 about the car')).toBe('Call at 10:30 about the car');
    expect(shortName(': a title that opens with a colon')).toBe(': a title that opens with a colon');
  });

  it("prefers the epic's todo_name when it is set", () => {
    expect(shortName(LONG, 'Deep Discipleship')).toBe('Deep Discipleship');
    expect(shortName(LONG, '   ')).toBe("Governor's Discipleship Institute list");
  });

  it('puts the short name on each list, the whole title kept beside it', () => {
    const lists = listsOf([bead('mw-a', { type: 'epic', title: LONG }), todo('mw-a.1', { parent: 'mw-a' }), bead('mw-b', { type: 'epic', title: LONG, todo_name: 'Deep Discipleship', created: at(10) }), todo('mw-b.1', { parent: 'mw-b' })]);
    expect(lists.map((list) => [list.id, list.name, list.title])).toEqual([
      ['mw-b', 'Deep Discipleship', LONG],
      ['mw-a', "Governor's Discipleship Institute list", LONG],
    ]);
  });

  it('reads todo_name from the view as text and drops anything else', () => {
    const view = decodeView(JSON.stringify({ v: 2, beads: [{ id: "mw-x", todo_name: "Deep Discipleship" }, { id: "mw-y", todo_name: 7 }] }));
    expect(view?.beads.map((b) => b.todo_name)).toEqual(['Deep Discipleship', undefined]);
  });
});

// mw-ev7oyy.15: within 48 hours of its due time (or past it) a card sorts above the rest, soonest first; then the important
// ones; then everything else in the order it came. A fake clock (NOW) says which side of the line each card is on.
describe('orderCards: due soon first, then important, then the rest', () => {
  const HOUR = 3_600_000;
  const card = (id: string, extra: Partial<TodoCard> = {}): TodoCard => ({ id, title: id, priority: 2, created: '', ...extra });
  const dueIn = (hours: number) => new Date(NOW + hours * HOUR).toISOString();
  const ids = (cards: TodoCard[]) => cards.map((c) => c.id);

  it('floats a card due within 48 hours above cards that are not due', () => {
    expect(ids(orderCards([card('a'), card('b'), card('c', { due: dueIn(30) })], NOW))).toEqual(['c', 'a', 'b']);
  });

  it('floats an overdue card too, and puts the soonest (the most overdue) first', () => {
    const cards = [card('a'), card('later', { due: dueIn(10) }), card('late', { due: dueIn(-80) }), card('mid', { due: dueIn(-1) })];
    expect(ids(orderCards(cards, NOW))).toEqual(['late', 'mid', 'later', 'a']);
  });

  it('keeps a card due in 49 hours where it was, and floats one due in exactly 48', () => {
    expect(ids(orderCards([card('a'), card('far', { due: dueIn(49) }), card('b')], NOW))).toEqual(['a', 'far', 'b']);
    expect(ids(orderCards([card('a'), card('edge', { due: dueIn(48) })], NOW))).toEqual(['edge', 'a']);
  });

  it('puts important cards after the due ones and before the rest, each group in its current order', () => {
    const cards = [card('a'), card('star2', { important: true }), card('b'), card('due', { due: dueIn(5) }), card('star1', { important: true })];
    expect(ids(orderCards(cards, NOW))).toEqual(['due', 'star2', 'star1', 'a', 'b']);
  });

  it('puts an important card that is also due soon among the due ones, by its due time', () => {
    const cards = [card('plain', { due: dueIn(20) }), card('both', { important: true, due: dueIn(2) }), card('star', { important: true })];
    expect(ids(orderCards(cards, NOW))).toEqual(['both', 'plain', 'star']);
  });

  it('leaves the order alone when nothing is due or important, and does not change the cards given', () => {
    const cards = [card('a'), card('b', { due: dueIn(100) }), card('c')];
    const before = ids(cards);
    expect(ids(orderCards(cards, NOW))).toEqual(['a', 'b', 'c']);
    expect(ids(cards)).toEqual(before);
  });

  it('reads a due time that is no time as no due time', () => {
    expect(ids(orderCards([card('a'), card('b', { due: 'soon' })], NOW))).toEqual(['a', 'b']);
  });
});

describe('the star on a card from the view', () => {
  it('reads todo_important only when it is true', () => {
    const view = decodeView(JSON.stringify({ v: 2, beads: [{ id: 'mw-a', todo_important: true }, { id: 'mw-b', todo_important: false }, { id: 'mw-c', todo_important: 'yes' }, { id: 'mw-d' }] }));
    expect(view.beads.map((b) => b.todo_important)).toEqual([true, undefined, undefined, undefined]);
  });

  it('reads todo_important from the view as the card being important', () => {
    const lists = listsOf([bead('mw-l', { type: 'epic' }), todo('mw-l.1', { parent: 'mw-l', todo_important: true }), todo('mw-l.2', { parent: 'mw-l' })]);
    expect(lists[0].cards.map((c) => [c.id, c.important])).toEqual([
      ['mw-l.1', true],
      ['mw-l.2', undefined],
    ]);
  });
});

// mw-ev7oyy.16: a list's cards fall into Today (due today or overdue, or tapped into Today for today), Soon (due within 7 days, or
// important) and Someday (the rest). A fake clock (NOW, a Tuesday at noon, UTC) says which day each card is due.
describe('groupOf and groupCards: Today, Soon and Someday', () => {
  const DAY = 86_400_000;
  const card = (id: string, extra: Partial<TodoCard> = {}): TodoCard => ({ id, title: id, priority: 2, created: '', ...extra });
  const dueDay = (days: number, hour = 9) => new Date(Date.parse('2026-10-13T00:00:00Z') + days * DAY + hour * 3_600_000).toISOString();
  const ids = (cards: TodoCard[]) => cards.map((c) => c.id);

  it('puts a card due today, even at a later hour, or overdue in Today', () => {
    expect(groupOf(card('a', { due: dueDay(0, 23) }), NOW, {})).toBe('today');
    expect(groupOf(card('b', { due: dueDay(0, 1) }), NOW, {})).toBe('today');
    expect(groupOf(card('c', { due: dueDay(-9) }), NOW, {})).toBe('today');
  });

  it('puts a card due tomorrow through seven days ahead in Soon, and one due in eight days in Someday', () => {
    expect(groupOf(card('a', { due: dueDay(1, 0) }), NOW, {})).toBe('soon');
    expect(groupOf(card('b', { due: dueDay(7, 23) }), NOW, {})).toBe('soon');
    expect(groupOf(card('c', { due: dueDay(8, 0) }), NOW, {})).toBe('someday');
  });

  it('puts an important card in Soon, however far off or undated, but a due-today one in Today', () => {
    expect(groupOf(card('a', { important: true }), NOW, {})).toBe('soon');
    expect(groupOf(card('b', { important: true, due: dueDay(30) }), NOW, {})).toBe('soon');
    expect(groupOf(card('c', { important: true, due: dueDay(0) }), NOW, {})).toBe('today');
  });

  it('puts a card with no due time, or one that is no time, in Someday', () => {
    expect(groupOf(card('a'), NOW, {})).toBe('someday');
    expect(groupOf(card('b', { due: 'soon' }), NOW, {})).toBe('someday');
  });

  it('moves a card to Today for today only: the day it was tapped is the day it counts', () => {
    const picks = { a: dayKey(NOW) };
    expect(groupOf(card('a'), NOW, picks)).toBe('today');
    expect(groupOf(card('a'), NOW + DAY, picks)).toBe('someday');
    expect(groupOf(card('a', { important: true }), NOW + DAY, picks)).toBe('soon');
    expect(groupOf(card('a', { due: dueDay(3) }), NOW + 2 * DAY, picks)).toBe('soon');
  });

  it('keeps a pick for yesterday from pulling a card into Today', () => {
    expect(groupOf(card('a'), NOW, { a: '2026-10-12' })).toBe('someday');
  });

  it('puts the cards in Today, Soon, Someday order, each group in the order orderCards gave, and says the group on each', () => {
    const cards = [card('s0'), card('star', { important: true }), card('late', { due: dueDay(-1) }), card('tmrw', { due: dueDay(1) }), card('s1'), card('today', { due: dueDay(0, 20) }), card('week', { due: dueDay(5) })];
    const grouped = groupCards(cards, NOW, {});
    expect(ids(grouped)).toEqual(['late', 'today', 'tmrw', 'star', 'week', 's0', 's1']);
    expect(grouped.map((c) => c.group)).toEqual(['today', 'today', 'soon', 'soon', 'soon', 'someday', 'someday']);
  });

  it('uses the float inside a group: the due-soon ones first, then the important ones, then the rest in his order', () => {
    const cards = [card('plain5', { due: dueDay(5) }), card('star', { important: true }), card('tmrw', { due: dueDay(1, 3) })];
    expect(ids(groupCards(cards, NOW, {}))).toEqual(['tmrw', 'star', 'plain5']);
  });

  it('marks a card the pick put in Today as tapped, and does not mark one that is there by its own due time', () => {
    const grouped = groupCards([card('a'), card('b', { due: dueDay(0) })], NOW, { a: dayKey(NOW), b: dayKey(NOW) });
    expect(grouped.map((c) => [c.id, c.group, c.tapped])).toEqual([
      ['b', 'today', undefined],
      ['a', 'today', true],
    ]);
  });

  it('does not change the cards given', () => {
    const cards = [card('a'), card('b', { important: true })];
    groupCards(cards, NOW, { a: dayKey(NOW) });
    expect(cards).toEqual([card('a'), card('b', { important: true })]);
  });

  it('counts the cards of each group, leaving an empty group out, in the order Today, Soon, Someday', () => {
    const grouped = groupCards([card('a'), card('b'), card('c', { due: dueDay(0) }), card('d', { important: true }), card('e')], NOW, {});
    expect(groupCounts(grouped)).toEqual([
      { group: 'today', count: 1 },
      { group: 'soon', count: 1 },
      { group: 'someday', count: 3 },
    ]);
    expect(groupCounts(groupCards([card('a')], NOW, {}))).toEqual([{ group: 'someday', count: 1 }]);
  });

  it('reads the day in the phone zone: a day key is the calendar date', () => {
    expect(dayKey(NOW)).toBe('2026-10-13');
  });
});

describe("a card's text action from the view's summary (mw-ev7oyy.22)", () => {
  const cardOf = (summary: string) => listsOf([bead('mw-l', { type: 'epic' }), todo('mw-l.1', { parent: 'mw-l', summary })])[0].cards[0];

  it("carries the Text: line of a whole summary", () => {
    expect(cardOf('Ask about Saturday.\n\nText: Dad +15165550123 | Hi Dad').text).toEqual({ name: 'Dad', number: '+15165550123', draft: 'Hi Dad' });
    expect(cardOf('No text here.').text).toBeUndefined();
  });

  it('carries none from a summary that may be cut short, whose draft may be cut too: the board reads the whole notes', () => {
    const cut = `${'x'.repeat(250)}\n\nText: Dad +15165550123 | Hi Dad, would Saturday`;
    expect(cardOf(cut).summaryCut).toBe(true);
    expect(cardOf(cut).text).toBeUndefined();
  });
});

describe("a card's chips from the view's summary (mw-ev7oyy.17)", () => {
  const cardOf = (summary: string) => listsOf([bead('mw-l', { type: 'epic' }), todo('mw-l.1', { parent: 'mw-l', summary })])[0].cards[0];

  it('names each chip by its book when the notes hold an Open: line per book, and keeps the app alone for one line', () => {
    const two = 'Open: Deep Discipleship [Kindle](kindle://a) · [Audible](https://www.audible.com/pd/B0CC36V9KG)\nOpen: You Are a Theologian [Kindle](kindle://b) · [Audible](https://www.audible.com/pd/B07ZJYQWXR)';
    expect(cardOf(two).links?.map(openLinkLabel)).toEqual(['Kindle · Deep Discipleship', 'Audible · Deep Discipleship', 'Kindle · You Are a Theologian', 'Audible · You Are a Theologian']);
    expect(cardOf('Open: Deep Discipleship [Kindle](kindle://a) · [Audible](https://www.audible.com/pd/B0CC36V9KG)').links?.map(openLinkLabel)).toEqual(['Kindle', 'Audible']);
  });
});

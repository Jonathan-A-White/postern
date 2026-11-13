// mw-6ww.175.11 (B8, B12): the layers of src, lowest first, and the upward imports that exist today.
// A layer is a group of top-level directories under src/; an import may go to the same layer or a lower one.
// The list below may only shrink: tests/unit/layers.test.ts fails when it is longer than the count recorded
// there. Fix an inversion by moving what it needs down a layer, then delete its line here and lower the count.
// (docs/module-map.md section 4: the model is not pure; the database layer imports upward.)
export const LAYERS = [['data'], ['model'], ['services'], ['cockpit', 'todo', 'key']];

export const INVERSIONS = [
  'src/data/repositories/accounts-repo.ts -> src/model/ideasOnly',
  'src/data/repositories/cards-repo.ts -> src/model/cards',
  'src/data/repositories/drafts-repo.ts -> src/services/threads',
  'src/data/repositories/messages-repo.ts -> src/model/twins',
  'src/data/repositories/settings-repo.ts -> src/model/ideasOnly',
  'src/data/tidy.ts -> src/model/twins',
  'src/model/call.ts -> src/services/call',
  'src/model/cards.ts -> src/services/threads',
  'src/model/conversation.ts -> src/services/questions',
  'src/model/conversation.ts -> src/services/threads',
  'src/model/events.ts -> src/services/questions',
  'src/model/messageParts.ts -> src/services/threads',
  'src/model/needs.ts -> src/services/questions',
  'src/model/needs.ts -> src/services/threads',
  'src/model/outbox.ts -> src/services/questions',
  'src/model/talkLine.ts -> src/services/threads',
  'src/model/talkLog.ts -> src/services/talk',
  'src/model/talkLog.ts -> src/services/threads',
  'src/model/talkScreen.ts -> src/services/threads',
  'src/model/threads.ts -> src/services/threads',
  'src/model/view.ts -> src/services/questions',
];

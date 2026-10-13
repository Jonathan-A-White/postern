// src/cockpit/TodoScreen.tsx — the To do tab (mw-ev7oyy.4): his own outside things as a board.
// The board is src/todo/'s; this is only its place in the cockpit.
import { Screen } from './Shell';
import { TodoBoard } from '../todo';

export function TodoScreen() {
  return (
    <Screen title="To do" subtitle="Your own lists" bare>
      <TodoBoard />
    </Screen>
  );
}

// src/cockpit/NoticeScreen.tsx — where a tap on a push about a record lands when
// the phone has not yet decrypted that message (mw-f758y.25). A push names only
// the record's txid and class, so the thread it is about is known once the app is
// unlocked and its sync has fetched and decrypted the message; this waits for that
// row and moves to its thread. If it never turns up it gives way to where the
// class belongs (the queue for a decision, Talk for a message).
import { useEffect } from 'react';
import { EmptyState, Spinner } from '../ui';
import { Screen } from './Shell';
import { useMessages } from './hooks';
import { navigate } from '../router';
import { CLASS_URLS } from '../push/classOptions';
import { threadUrlOfMessage } from '../push/tapTarget';
import type { MessageClass } from '../data/db';

/** How long to wait for the message before giving way to the class's own place. */
const WAIT_MS = 8000;

export function NoticeScreen({ tx, cls, waitMs = WAIT_MS }: { tx: string; cls?: MessageClass; waitMs?: number }) {
  const messages = useMessages();
  const thread = threadUrlOfMessage(messages.find((row) => row.txid === tx));

  useEffect(() => {
    if (thread) navigate(thread.replace(/^\//, ''), { replace: true });
  }, [thread]);

  useEffect(() => {
    const timer = setTimeout(() => navigate((CLASS_URLS[cls ?? 'decision-needed'] ?? '/?v=needs').replace(/^\//, ''), { replace: true }), waitMs);
    return () => clearTimeout(timer);
  }, [cls, waitMs]);

  return (
    <Screen title="Opening" back={{ view: 'needs' }}>
      <div className="flex flex-col items-center gap-3 py-16 text-muted">
        <Spinner size={22} />
        <EmptyState icon="bell" title="Finding what it is about">Fetching the message from the Mayor.</EmptyState>
      </div>
    </Screen>
  );
}

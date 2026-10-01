// src/cockpit/NoticeScreen.tsx — where a tap on a push about a record lands when
// the phone has not yet decrypted that message (mw-f758y.25). A push names only
// the record's txid and class, so the thread it is about is known once the app is
// unlocked and its sync has fetched and decrypted the message; this waits for that
// row and moves to its thread. On a cold start that sync starts only after the
// unlock and a few round trips, so it waits for the app's own sync to finish
// rather than for a fixed time (mw-gq6.163): it asks for one more if the first
// brought nothing, and only when both have finished without the message does it
// give way to where the class belongs (the queue for a decision, Talk for a
// message). A sync that never finishes is cut short by a long last-resort timer.
import { useEffect, useState } from 'react';
import { EmptyState, Spinner } from '../ui';
import { Screen } from './Shell';
import { useMessages } from './hooks';
import { navigate } from '../router';
import { CLASS_URLS } from '../push/classOptions';
import { threadUrlOfMessage } from '../push/tapTarget';
import { getLiveState, refreshNow, useLive } from '../services/live';
import type { MessageClass } from '../data/db';

/** The last resort when no sync finishes at all (a connection that hangs). */
const WAIT_MS = 60_000;
/** After the second sync finishes, how long the stored message gets to show up before giving way. */
const GRACE_MS = 1500;

interface NoticeScreenProps {
  tx: string;
  cls?: MessageClass;
  waitMs?: number;
  graceMs?: number;
}

export function NoticeScreen({ tx, cls, waitMs = WAIT_MS, graceMs = GRACE_MS }: NoticeScreenProps) {
  const messages = useMessages();
  const thread = threadUrlOfMessage(
    messages.find((row) => row.txid === tx),
    messages,
  );
  const [syncsAtOpen] = useState(() => getLiveState().syncs);
  const synced = useLive().syncs - syncsAtOpen;

  useEffect(() => {
    if (thread) navigate(thread.replace(/^\//, ''), { replace: true });
  }, [thread]);

  // Bring the message in now (a no-op until the live connection exists, whose first sync then does it).
  useEffect(() => {
    void refreshNow();
  }, []);

  // The first sync since opening brought nothing yet: ask for one more, in case it began before the message was out.
  useEffect(() => {
    if (synced === 1 && !thread) void refreshNow();
  }, [synced, thread]);

  const settled = synced >= 2;
  useEffect(() => {
    const giveWay = () => navigate((CLASS_URLS[cls ?? 'decision-needed'] ?? '/?v=needs').replace(/^\//, ''), { replace: true });
    const timer = setTimeout(giveWay, settled ? graceMs : waitMs);
    return () => clearTimeout(timer);
  }, [cls, settled, waitMs, graceMs]);

  return (
    <Screen title="Opening" back={{ view: 'needs' }}>
      <div className="flex flex-col items-center gap-3 py-16 text-muted">
        <Spinner size={22} />
        <EmptyState icon="bell" title="Finding what it is about">Fetching the message from the Mayor.</EmptyState>
      </div>
    </Screen>
  );
}

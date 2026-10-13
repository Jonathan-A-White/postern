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
// But a tap does not depend on that sync alone (mw-8oshb2.1): with the key unlocked the one record it
// names is fetched by its txid at once, the live connection is started (or woken) if it is not up, and
// the screen gives way after DIRECT_WAIT_MS with a note that it could not open the message, so a phone
// that woke with its connection dead never spins past a few seconds.
import { useEffect, useState } from 'react';
import { EmptyState, Spinner } from '../ui';
import { Screen } from './Shell';
import { useMessages, useUnlockedKey } from './hooks';
import { navigate } from '../router';
import { CLASS_URLS } from '../push/classOptions';
import { threadUrlOfMessage } from '../push/tapTarget';
import { getLiveState, openRecordNow, refreshNow, useLive } from '../services/live';
import { toast } from '../ui/toastStore';
import type { MessageClass } from '../data/db';

/** The last resort when no sync finishes at all (a connection that hangs) and there is no key to fetch the record with. */
const WAIT_MS = 60_000;
/** How long the record fetched by its txid gets to arrive before giving way: the Governor's "never a spinner past ~5 s". */
const DIRECT_WAIT_MS = 5000;
/** After the second sync finishes, how long the stored message gets to show up before giving way. */
const GRACE_MS = 1500;

interface NoticeScreenProps {
  tx: string;
  cls?: MessageClass;
  waitMs?: number;
  graceMs?: number;
}

export function NoticeScreen({ tx, cls, waitMs, graceMs = GRACE_MS }: NoticeScreenProps) {
  const messages = useMessages();
  const key = useUnlockedKey();
  const holdsKey = key !== null;
  const giveUpMs = waitMs ?? (holdsKey ? DIRECT_WAIT_MS : WAIT_MS);
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

  // And fetch the one record by its txid, not waiting for any of that (a no-op without the unlocked key).
  useEffect(() => {
    void openRecordNow(tx);
  }, [tx, holdsKey]);

  // The first sync since opening brought nothing yet: ask for one more, in case it began before the message was out.
  useEffect(() => {
    if (synced === 1 && !thread) void refreshNow();
  }, [synced, thread]);

  const settled = synced >= 2;
  useEffect(() => {
    const giveWay = () => {
      toast('Could not open that message yet', 'error');
      navigate((CLASS_URLS[cls ?? 'decision-needed'] ?? '/?v=needs').replace(/^\//, ''), { replace: true });
    };
    const timer = setTimeout(giveWay, settled ? graceMs : giveUpMs);
    return () => clearTimeout(timer);
  }, [cls, settled, giveUpMs, graceMs]);

  return (
    <Screen title="Opening" back={{ view: 'needs' }}>
      <div className="flex flex-col items-center gap-3 py-16 text-muted">
        <Spinner size={22} />
        <EmptyState icon="bell" title="Finding what it is about">Fetching the message from the Mayor.</EmptyState>
      </div>
    </Screen>
  );
}

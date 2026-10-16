// src/App.tsx — Postern as one cockpit (plans/0021). The door first: no key, set
// one up; locked, unlock once for the day; then every place is a route
// (src/nav/route.ts) inside the one shell, and the live connection
// (src/services/live.ts) runs for as long as the key is unlocked.
import { useEffect, useState, useSyncExternalStore } from 'react';
import { KeyVault } from './key';
import { navigate, useRoute, useScreenSearch } from './router';
import { vaultRepo } from './data/repositories';
import type { VaultRow } from './data/db';
import { resumeSession } from './services/keySession';
import { startLive, stopLive } from './services/live';
import { startOutbox } from './services/outbox';
import { useUnlockedKey } from './cockpit/hooks';
import { Shell, Screen } from './cockpit/Shell';
import { LaunchFailed, Loading, Unlock, Welcome } from './cockpit/Gate';
import { UpdateBanner } from './cockpit/UpdateBanner';
import { WhatsNewOnUpdate } from './cockpit/WhatsNew';
import { NeedsScreen } from './cockpit/NeedsScreen';
import { MapScreen } from './cockpit/MapScreen';
import { BeadScreen } from './cockpit/BeadScreen';
import { TalkScreen } from './cockpit/TalkScreen';
import { TalkLineScreen } from './cockpit/TalkLineScreen';
import { SearchScreen } from './cockpit/SearchScreen';
import { MeScreen } from './cockpit/MeScreen';
import { PromptsScreen } from './cockpit/PromptsScreen';
import { AboutScreen } from './cockpit/AboutScreen';
import { ShareScreen } from './cockpit/ShareScreen';
import { NoticeScreen } from './cockpit/NoticeScreen';
import { AlarmScreen } from './cockpit/AlarmScreen';
import { EmergencyScreen } from './cockpit/EmergencyScreen';
import { ArchiveScreen } from './cockpit/ArchiveScreen';
import { RoadmapScreen } from './cockpit/RoadmapScreen';
import { TodoScreen } from './cockpit/TodoScreen';
import { ToastHost } from './ui/toast';
import { answerSeen } from './services/seen';
import { sendCallLater } from './cockpit/send';
import { settingsRepo } from './data/repositories';
import type { Route } from './nav/route';
import { saveLastRoute } from './nav/lastRoute';
import { setVisibleInterval } from './ui/visibleInterval';
import { clearDbTrouble, getDbTrouble, onDbTrouble } from './data/dbTrouble';
import { tidyWhenIdle } from './data/tidy';

const whyItFailed = (err: unknown): string => (err instanceof Error ? err.message : String(err));

function Place({ route }: { route: Route }) {
  switch (route.view) {
    case 'map':
      return <MapScreen key={`${route.bucket ?? ''}|${route.filter ?? ''}|${route.landed ?? ''}`} focus={route.focus} lens={route.lens} bucket={route.bucket} filter={route.filter} landed={route.landed} />;
    case 'bead':
      return <BeadScreen key={route.id} id={route.id} />;
    case 'talk':
      return <TalkScreen thread={route.thread} root={route.root} prefill={route.prefill} />;
    case 'line':
      return <TalkLineScreen />;
    case 'search':
      return <SearchScreen q={route.q} />;
    case 'me':
      return <MeScreen />;
    case 'prompts':
      return <PromptsScreen />;
    case 'about':
      return <AboutScreen />;
    case 'share':
      return <ShareScreen id={route.id} />;
    case 'notice':
      return <NoticeScreen key={route.tx} tx={route.tx} cls={route.cls} />;
    case 'alarm':
      return <AlarmScreen title={route.title} body={route.body} ts={route.ts} />;
    case 'emergency':
      return <EmergencyScreen />;
    case 'archive':
      return <ArchiveScreen />;
    case 'roadmap':
      return <RoadmapScreen />;
    case 'todo':
      return <TodoScreen />;
    default:
      return <NeedsScreen who={route.view === 'needs' ? route.who : undefined} />;
  }
}

function KeyPlace({ inShell }: { inShell: boolean }) {
  const body = (
    <div className="flex justify-center">
      <KeyVault />
    </div>
  );
  if (!inShell) return <main className="scroll-thin h-dvh overflow-y-auto bg-canvas">{body}</main>;
  return (
    <Screen title="Key and licence" back={{ view: 'me' }}>
      {body}
    </Screen>
  );
}

export function App() {
  const route = useRoute();
  const search = useScreenSearch();
  const key = useUnlockedKey();
  const [vault, setVault] = useState<VaultRow | null | undefined>(undefined);
  const [resumed, setResumed] = useState(false);
  // What the launch could not read (mw-4gkijo.1): said on the door, never a padlock for ever.
  const [vaultError, setVaultError] = useState<string | null>(null);
  const [resumeError, setResumeError] = useState<string | null>(null);
  const dbTrouble = useSyncExternalStore(onDbTrouble, getDbTrouble, getDbTrouble);

  // Where he is, kept on every move, is where a bare open puts him back (src/nav/lastRoute.ts).
  useEffect(() => saveLastRoute(search), [search]);

  // A read that answers after the app has closed, or after a newer read, sets nothing (mw-ev7oyy.21).
  useEffect(() => {
    let cancelled = false;
    resumeSession()
      .catch((err: unknown) => {
        if (!cancelled) setResumeError(whyItFailed(err));
      })
      .finally(() => {
        if (!cancelled) setResumed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void vaultRepo.get().then(
      (row) => {
        clearDbTrouble();
        if (cancelled) return;
        setVaultError(null);
        setVault(row ?? null);
      },
      (err: unknown) => {
        if (!cancelled) setVaultError(whyItFailed(err));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [key, route.view]);

  // The history-wide clean-ups wait until the door or the app is on screen (src/data/tidy.ts).
  const shown = vault !== undefined;
  useEffect(() => (shown ? tidyWhenIdle() : undefined), [shown]);

  useEffect(() => {
    if (key) startLive(key);
    else stopLive();
  }, [key]);

  // What he did and has not yet gone (mw-jrx0s.10) is sent on open, and again when the phone is back in reach.
  useEffect(() => startOutbox(), []);

  // A notification tapped while the app is open (src/sw.ts) says where to go.
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; url?: string; txid?: string } | undefined;
      if (data?.type === 'open' && data.url) navigate(data.url.replace(/^\//, '') || '?v=needs');
      // The worker asks whether a pushed message is already on screen, to show no notification for it (mw-gq6.166).
      if (data?.type === 'seen?' && data.txid) {
        const txid = data.txid;
        const reply = (event.source ?? navigator.serviceWorker.controller) as { postMessage(message: unknown): void } | null;
        void answerSeen(txid)
          .catch(() => false)
          .then((seen) => reply?.postMessage({ type: 'seen', txid, seen }));
      }
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, []);

  // His Later taps on a ring (src/sw.ts): an open window sends the record; one that cannot yet, or a
  // tap made with no window, waits in IndexedDB until the app is unlocked and the Mayor's key is known.
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    const putOff = async (ringTxid: string) => {
      try {
        if (!key) throw new Error('locked');
        await sendCallLater(ringTxid);
      } catch {
        await settingsRepo.addPendingLater(ringTxid);
      }
    };
    const drain = async () => {
      if (!key) return;
      for (const ringTxid of await settingsRepo.takePendingLaters()) await putOff(ringTxid);
    };
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; ring_txid?: string } | undefined;
      if (data?.type === 'later' && data.ring_txid) void putOff(data.ring_txid);
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    void drain().catch(() => undefined);
    // Not while the page is hidden; once on return (mw-xhtcup.1).
    const stopRetry = setVisibleInterval(() => void drain().catch(() => undefined), 15_000);
    return () => {
      navigator.serviceWorker.removeEventListener('message', onMessage);
      stopRetry();
    };
  }, [key]);

  let content;
  // The door (loading, welcome, unlock) has no Shell, so the update banner sits above it here.
  let door = true;
  if (route.view === 'key') {
    door = !key;
    content = key ? <Shell route={route}><KeyPlace inShell /></Shell> : <KeyPlace inShell={false} />;
  } else if (dbTrouble === 'changed') {
    content = <LaunchFailed message="Postern was updated in another window, so this one is reloading." />;
  } else if (vault === undefined && vaultError) {
    content = <LaunchFailed message="Postern could not open your vault." detail={vaultError} />;
  } else if (!resumed || vault === undefined) {
    content = dbTrouble === 'blocked' ? <Loading waiting="Another Postern window is holding the database. Close it, then tap Try again." known /> : <Loading />;
  } else if (vault === null) content = <Welcome />;
  else if (!key) content = <Unlock vault={vault} earlier={resumeError ? `Your earlier unlock could not be read (${resumeError}). Unlock again.` : undefined} />;
  else {
    door = false;
    content = (
      <Shell route={route}>
        <Place route={route} />
      </Shell>
    );
  }

  return (
    <>
      {door && <UpdateBanner />}
      {content}
      {!door && <WhatsNewOnUpdate />}
      <ToastHost />
    </>
  );
}

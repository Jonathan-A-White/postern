// src/App.tsx — Postern as one cockpit (plans/0021). The door first: no key, set
// one up; locked, unlock once for the day; then every place is a route
// (src/nav/route.ts) inside the one shell, and the live connection
// (src/services/live.ts) runs for as long as the key is unlocked.
import { useEffect, useState } from 'react';
import { KeyVault } from './key';
import { navigate, useRoute, useScreenSearch } from './router';
import { vaultRepo } from './data/repositories';
import type { VaultRow } from './data/db';
import { resumeSession } from './services/keySession';
import { startLive, stopLive } from './services/live';
import { startOutbox } from './services/outbox';
import { useUnlockedKey } from './cockpit/hooks';
import { Shell, Screen } from './cockpit/Shell';
import { Loading, Unlock, Welcome } from './cockpit/Gate';
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
import { ToastHost } from './ui/toast';
import { answerSeen } from './services/seen';
import { sendCallLater } from './cockpit/send';
import { settingsRepo } from './data/repositories';
import type { Route } from './nav/route';
import { saveLastRoute } from './nav/lastRoute';
import { setVisibleInterval } from './ui/visibleInterval';

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

  // Where he is, kept on every move, is where a bare open puts him back (src/nav/lastRoute.ts).
  useEffect(() => saveLastRoute(search), [search]);

  useEffect(() => {
    void resumeSession().finally(() => setResumed(true));
  }, []);

  useEffect(() => {
    void vaultRepo.get().then((row) => setVault(row ?? null));
  }, [key, route.view]);

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
    void drain();
    // Not while the page is hidden; once on return (mw-xhtcup.1).
    const stopRetry = setVisibleInterval(() => void drain(), 15_000);
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
  } else if (!resumed || vault === undefined) content = <Loading />;
  else if (vault === null) content = <Welcome />;
  else if (!key) content = <Unlock vault={vault} />;
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

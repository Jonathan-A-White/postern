// src/App.tsx — Postern as one cockpit (plans/0021). The door first: no key, set
// one up; locked, unlock once for the day; then every place is a route
// (src/nav/route.ts) inside the one shell, and the live connection
// (src/services/live.ts) runs for as long as the key is unlocked.
import { useEffect, useState } from 'react';
import { KeyVault } from './key';
import { navigate, useRoute } from './router';
import { vaultRepo } from './data/repositories';
import type { VaultRow } from './data/db';
import { resumeSession } from './services/keySession';
import { startLive, stopLive } from './services/live';
import { useUnlockedKey } from './cockpit/hooks';
import { Shell, Screen } from './cockpit/Shell';
import { Loading, Unlock, Welcome } from './cockpit/Gate';
import { NeedsScreen } from './cockpit/NeedsScreen';
import { MapScreen } from './cockpit/MapScreen';
import { BeadScreen } from './cockpit/BeadScreen';
import { TalkScreen } from './cockpit/TalkScreen';
import { SearchScreen } from './cockpit/SearchScreen';
import { MeScreen } from './cockpit/MeScreen';
import { ShareScreen } from './cockpit/ShareScreen';
import { NoticeScreen } from './cockpit/NoticeScreen';
import { AlarmScreen } from './cockpit/AlarmScreen';
import { ToastHost } from './ui/toast';
import type { Route } from './nav/route';

function Place({ route }: { route: Route }) {
  switch (route.view) {
    case 'map':
      return <MapScreen key={`${route.bucket ?? ''}|${route.filter ?? ''}`} focus={route.focus} lens={route.lens} bucket={route.bucket} filter={route.filter} />;
    case 'bead':
      return <BeadScreen key={route.id} id={route.id} />;
    case 'talk':
      return <TalkScreen thread={route.thread} />;
    case 'search':
      return <SearchScreen q={route.q} />;
    case 'me':
      return <MeScreen />;
    case 'share':
      return <ShareScreen id={route.id} />;
    case 'notice':
      return <NoticeScreen key={route.tx} tx={route.tx} cls={route.cls} />;
    case 'alarm':
      return <AlarmScreen title={route.title} body={route.body} ts={route.ts} />;
    default:
      return <NeedsScreen />;
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
  const key = useUnlockedKey();
  const [vault, setVault] = useState<VaultRow | null | undefined>(undefined);
  const [resumed, setResumed] = useState(false);

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

  // A notification tapped while the app is open (src/sw.ts) says where to go.
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; url?: string } | undefined;
      if (data?.type === 'open' && data.url) navigate(data.url.replace(/^\//, '') || '?v=needs');
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, []);

  let content;
  if (route.view === 'key') content = key ? <Shell route={route}><KeyPlace inShell /></Shell> : <KeyPlace inShell={false} />;
  else if (!resumed || vault === undefined) content = <Loading />;
  else if (vault === null) content = <Welcome />;
  else if (!key) content = <Unlock vault={vault} />;
  else
    content = (
      <Shell route={route}>
        <Place route={route} />
      </Shell>
    );

  return (
    <>
      {content}
      <ToastHost />
    </>
  );
}

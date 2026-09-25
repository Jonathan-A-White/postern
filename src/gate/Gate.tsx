import { useEffect, useState } from 'react';
import { vaultRepo, messagesRepo } from '../data/repositories';
import { addressForPublicKey, checkLicence, getCachedLicenceStatus } from '../services/licence';
import { subscribeToPush } from '../services/push';

type GateScreen =
  | { name: 'loading' }
  | { name: 'no-key' }
  | { name: 'no-licence'; address: string }
  | { name: 'licensed'; address: string; publicKeyHex: string };

type NotifyState =
  | { name: 'idle' }
  | { name: 'subscribing' }
  | { name: 'subscribed' }
  | { name: 'error'; message: string };

// Pure (no setState here — see the callers, each of which applies the result in its
// own `.then`): reads the vault, then asks the licence service for a fresh answer,
// falling back to whatever was cached last if the chain can't be reached right now.
async function determineScreen(): Promise<GateScreen> {
  const vault = await vaultRepo.get();
  if (!vault) return { name: 'no-key' };

  const address = addressForPublicKey(vault.publicKeyHex);
  try {
    const fresh = await checkLicence(vault.publicKeyHex);
    return fresh.held
      ? { name: 'licensed', address, publicKeyHex: vault.publicKeyHex }
      : { name: 'no-licence', address };
  } catch {
    const cached = await getCachedLicenceStatus();
    return cached?.held
      ? { name: 'licensed', address, publicKeyHex: vault.publicKeyHex }
      : { name: 'no-licence', address };
  }
}

export function Gate() {
  const [screen, setScreen] = useState<GateScreen>({ name: 'loading' });
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifyState, setNotifyState] = useState<NotifyState>({ name: 'idle' });

  useEffect(() => {
    void determineScreen().then(setScreen);
  }, []);

  useEffect(() => {
    void messagesRepo.countUnread().then(setUnreadCount);
  }, []);

  async function handleNotifyMe(publicKeyHex: string) {
    setNotifyState({ name: 'subscribing' });
    try {
      await subscribeToPush({ publicKeyHex });
      setNotifyState({ name: 'subscribed' });
    } catch (err) {
      setNotifyState({ name: 'error', message: (err as Error).message });
    }
  }

  if (screen.name === 'licensed') {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-2 bg-slate-900 text-slate-200">
        <h1 className="text-3xl font-semibold">Postern</h1>
        <p className="text-xl">Licensed</p>
        <p className="text-sm text-slate-400">Testnet address: {screen.address}</p>
        <a className="text-sm underline" href="?screen=inbox">
          Inbox{unreadCount > 0 && <span data-testid="unread-count"> ({unreadCount})</span>}
        </a>
        <a className="text-sm underline" href="?screen=projects">
          Projects
        </a>
        <a className="text-sm underline" href="?screen=compose">
          Send a message
        </a>
        <a className="text-sm underline" href="?screen=key">
          Manage your key
        </a>
        <button
          className="rounded bg-slate-700 px-4 py-2"
          disabled={notifyState.name === 'subscribing' || notifyState.name === 'subscribed'}
          onClick={() => void handleNotifyMe(screen.publicKeyHex)}
        >
          Notify me
        </button>
        {notifyState.name === 'subscribed' && <p className="text-sm text-slate-400">Notifications enabled.</p>}
        {notifyState.name === 'error' && (
          <p role="alert" className="text-red-400">
            {notifyState.message}
          </p>
        )}
        <p className="text-sm text-slate-400">v{__APP_VERSION__}</p>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-2 bg-slate-900 text-slate-200">
      <h1 className="text-3xl font-semibold">Postern</h1>
      <p className="text-xl">The gate is locked</p>

      {screen.name === 'no-key' && (
        <a className="text-sm underline" href="?screen=key">
          Set up your key
        </a>
      )}

      {screen.name === 'no-licence' && (
        <>
          <p className="text-sm text-slate-400">Testnet address: {screen.address}</p>
          <p className="text-sm text-slate-400">No licence found</p>
          <button className="rounded bg-slate-700 px-4 py-2" onClick={() => void determineScreen().then(setScreen)}>
            Check again
          </button>
        </>
      )}

      <p className="text-sm text-slate-400">v{__APP_VERSION__}</p>
    </main>
  );
}

// src/cockpit/Gate.tsx — the door (plans/0021 decision 14): a phone with no key
// yet is sent to set one up; a locked one asks for a fingerprint (or the recovery
// phrase where the phone has no passkey PRF) once, and stays open for the day.
import { useState } from 'react';
import { Button, Icon } from '../ui';
import type { VaultRow } from '../data/db';
import { unlockWithPasskey, unlockWithPhrase } from '../services/unlock';
import { formatRoute } from '../nav/route';

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex h-dvh flex-col items-center justify-center bg-canvas px-6 text-fg">
      <div className="flex w-full max-w-sm flex-col items-center gap-6 text-center">
        <span className="flex h-16 w-16 items-center justify-center rounded-3xl bg-accent text-accent-fg shadow-lg shadow-accent/20">
          <Icon name="key" size={30} strokeWidth={2} />
        </span>
        <div className="flex flex-col gap-1.5">
          <h1 className="text-[26px] font-semibold tracking-tight">Postern</h1>
          <p className="text-[14.5px] text-muted">The Governor's cockpit for the factory.</p>
        </div>
        {children}
        <p className="text-[11.5px] text-faint">v{__APP_VERSION__}</p>
      </div>
    </main>
  );
}

export function Welcome() {
  return (
    <Frame>
      <p className="text-[14px] text-muted">This phone has no key yet. Set one up to open the gate.</p>
      <a href={formatRoute({ view: 'key' })} className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-accent font-semibold text-accent-fg">
        <Icon name="key" size={18} />
        Set up your key
      </a>
    </Frame>
  );
}

export function Loading() {
  return (
    <main className="flex h-dvh items-center justify-center bg-canvas text-muted" aria-busy="true">
      <span className="flex h-14 w-14 animate-pulse items-center justify-center rounded-3xl bg-raised">
        <Icon name="key" size={26} />
      </span>
    </main>
  );
}

export function Unlock({ vault }: { vault: VaultRow }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [phrase, setPhrase] = useState('');

  async function withPasskey() {
    setBusy(true);
    setError(null);
    try {
      await unlockWithPasskey(vault);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function withPhrase() {
    setBusy(true);
    setError(null);
    try {
      await unlockWithPhrase(vault, phrase);
      setPhrase('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Frame>
      {vault.mode === 'prf' ? (
        <Button variant="primary" size="lg" icon="fingerprint" className="w-full" busy={busy} onClick={() => void withPasskey()}>
          Unlock with your fingerprint
        </Button>
      ) : (
        <form
          className="flex w-full flex-col gap-3 text-left"
          onSubmit={(event) => {
            event.preventDefault();
            void withPhrase();
          }}
        >
          <label htmlFor="recovery-phrase" className="text-[13px] text-muted">
            Recovery phrase
          </label>
          <textarea id="recovery-phrase" rows={3} value={phrase} onChange={(event) => setPhrase(event.target.value)} autoComplete="off" spellCheck={false} />
          <Button type="submit" variant="primary" size="lg" busy={busy} disabled={!phrase.trim()}>
            Unlock
          </Button>
        </form>
      )}
      {error && (
        <p role="alert" className="text-[13.5px] text-danger">
          {error}
        </p>
      )}
      <p className="text-[12.5px] text-faint">Stays unlocked on this phone for a day, or until you lock it.</p>
      <a href={formatRoute({ view: 'key' })} className="text-[13px] text-muted underline underline-offset-2">
        Manage key
      </a>
    </Frame>
  );
}

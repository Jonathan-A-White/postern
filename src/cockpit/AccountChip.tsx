// src/cockpit/AccountChip.tsx — which account the app is on, in the top bar, once there is more than one (mw-9rp4hu.5): the name
// of the active account, and a tap opens the list to switch. With one account it shows nothing, so the bar is as it was.
// DoorAccounts is the same choice on the door (no key yet, locked), where there is no top bar.
import { useEffect, useRef, useState } from 'react';
import { Icon, cx, useAlive } from '../ui';
import { switchAccount } from '../services/accounts';
import { toast } from '../ui/toastStore';
import { useAccounts } from './useAccounts';

async function switchWithToast(id: string): Promise<boolean> {
  try {
    await switchAccount(id);
    return true;
  } catch (err) {
    toast(err instanceof Error ? err.message : String(err), 'error');
    return false;
  }
}

export function AccountChip() {
  const { accounts, activeId } = useAccounts();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const alive = useAlive();
  const box = useRef<HTMLDivElement>(null);

  // A tap anywhere else, or Escape, closes the list.
  useEffect(() => {
    if (!open) return;
    const away = (event: Event) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  if (accounts.length < 2) return null;
  const active = accounts.find((account) => account.id === activeId) ?? accounts[0];

  async function choose(id: string) {
    if (id === activeId) return setOpen(false);
    setBusy(true);
    await switchWithToast(id);
    if (alive()) {
      setBusy(false);
      setOpen(false);
    }
  }

  return (
    <div ref={box} className="relative" data-testid="account-chip">
      <button
        type="button"
        aria-label={`Account: ${active.name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Switch account"
        onClick={() => setOpen((was) => !was)}
        className="inline-flex h-8 max-w-[7.5rem] items-center gap-1 rounded-full border border-line bg-surface px-2.5 text-[12px] text-fg hover:bg-raised"
      >
        <span className="truncate">{active.name}</span>
        <Icon name="down" size={13} className="shrink-0 text-muted" />
      </button>
      {open && (
        <div role="menu" aria-label="Accounts" className="absolute top-full right-0 z-30 mt-1 flex min-w-44 max-w-64 flex-col rounded-xl border border-line bg-surface p-1 shadow-lg">
          {accounts.map((account) => (
            <button
              key={account.id}
              type="button"
              role="menuitem"
              disabled={busy}
              aria-current={account.id === activeId ? 'true' : undefined}
              onClick={() => void choose(account.id)}
              className={cx('flex h-10 items-center gap-2 rounded-lg px-3 text-left text-[14px] hover:bg-raised disabled:opacity-45', account.id === activeId && 'font-semibold')}
            >
              <span className="min-w-0 flex-1 truncate">{account.name}</span>
              {account.id === activeId && <Icon name="check" size={15} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** On the door: the accounts to go to, when there is more than one, so a locked or key-less account is never the end of the road. */
export function DoorAccounts() {
  const { accounts, activeId } = useAccounts();
  const [busy, setBusy] = useState(false);
  const alive = useAlive();
  if (accounts.length < 2) return null;
  const active = accounts.find((account) => account.id === activeId) ?? accounts[0];
  return (
    <section aria-label="Accounts" className="flex w-full flex-col gap-2 border-t border-line pt-4 text-[13px] text-muted">
      <p>
        Account: <span className="font-medium text-fg">{active.name}</span>
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        {accounts
          .filter((account) => account.id !== activeId)
          .map((account) => (
            <button
              key={account.id}
              type="button"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void switchWithToast(account.id).then(() => alive() && setBusy(false));
              }}
              className="inline-flex h-9 items-center rounded-lg border border-line px-3 text-fg hover:bg-raised disabled:opacity-45"
            >
              Switch to {account.name}
            </button>
          ))}
      </div>
    </section>
  );
}

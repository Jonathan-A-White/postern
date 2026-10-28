// src/cockpit/AccountsSection.tsx — Settings > Accounts (mw-9rp4hu.5): the accounts this phone keeps, the active one marked; Add account
// (a backend address, a name and which key: this phone's by default, a new one made at its door, or a recovery phrase pasted), checked with
// that backend before anything is kept; Switch to, Rename and Remove (with a confirm: its key is not deleted). Every control says what a tap
// does, and goes dead, saying so, while it works.
import { useState } from 'react';
import { Button, Card, Chip, SectionTitle, useAlive } from '../ui';
import { removeAccount, renameAccount, switchAccount, type Account } from '../services/accounts';
import { addAccountByUrl, type AddedAccount, type KeyChoice } from '../services/accountSetup';
import { useAccounts } from './useAccounts';

const inputClass = 'h-9 w-full rounded-lg border border-line bg-transparent px-2 text-[14px]';
const words = (err: unknown): string => (err instanceof Error ? err.message : String(err));

type Choice = KeyChoice['kind'];

const CHOICES: { kind: Choice; label: string; hint: string }[] = [
  { kind: 'same', label: "This phone's key", hint: 'The same key signs for both backends.' },
  { kind: 'new', label: 'A new key', hint: 'Made on its own door when you switch to it.' },
  { kind: 'pasted', label: 'A key I paste', hint: 'A recovery phrase you already have.' },
];

/** What the add said, in his words. */
function addedLine(added: AddedAccount, choice: Choice): string {
  const name = `“${added.account.name}”`;
  if (added.check === 'licensed') return `Added ${name}. Its backend knows this key.`;
  if (added.check === 'no-licence') return `Added ${name}, but that backend holds no licence for the key yet. Switch to it, then Manage key and licence.`;
  return choice === 'new' ? `Added ${name}. Switch to it to make its key.` : `Added ${name}. Its key is checked with its backend the first time you unlock it.`;
}

function AddForm({ onDone }: { onDone: (line: string) => void }) {
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [choice, setChoice] = useState<Choice>('same');
  const [phrase, setPhrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const alive = useAlive();

  async function submit() {
    setBusy(true);
    setError(undefined);
    try {
      const key: KeyChoice = choice === 'pasted' ? { kind: 'pasted', phrase } : { kind: choice };
      const added = await addAccountByUrl({ name, backendUrl: url, key });
      if (alive()) {
        setPhrase('');
        onDone(addedLine(added, choice));
      }
    } catch (err) {
      if (alive()) setError(words(err));
    } finally {
      if (alive()) setBusy(false);
    }
  }

  return (
    <form
      className="flex flex-col gap-3 px-4 py-3"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <label className="flex flex-col gap-1 text-[13px] text-muted">
        Backend address
        <input className={inputClass} value={url} disabled={busy} inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="https://example.org/api" onChange={(event) => setUrl(event.target.value)} />
      </label>
      <label className="flex flex-col gap-1 text-[13px] text-muted">
        Name
        <input className={inputClass} value={name} disabled={busy} placeholder="What to call it" onChange={(event) => setName(event.target.value)} />
      </label>
      <fieldset className="flex flex-col gap-2" disabled={busy}>
        <legend className="mb-1 text-[13px] text-muted">Key</legend>
        {CHOICES.map(({ kind, label, hint }) => (
          <div key={kind} className="flex items-start gap-2 text-[14px]">
            <input id={`account-key-${kind}`} type="radio" name="account-key" aria-describedby={`account-key-${kind}-hint`} className="mt-1 h-4 w-4 accent-[var(--pc-accent)]" checked={choice === kind} onChange={() => setChoice(kind)} />
            <span className="flex flex-col">
              <label htmlFor={`account-key-${kind}`}>{label}</label>
              <span id={`account-key-${kind}-hint`} className="text-[12px] text-muted">
                {hint}
              </span>
            </span>
          </div>
        ))}
      </fieldset>
      {choice === 'pasted' && (
        <label className="flex flex-col gap-1 text-[13px] text-muted">
          Recovery phrase
          <textarea className="rounded-lg border border-line bg-transparent p-2 text-[14px]" rows={3} value={phrase} disabled={busy} autoComplete="off" spellCheck={false} onChange={(event) => setPhrase(event.target.value)} />
        </label>
      )}
      {error && (
        <p role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary" size="sm" busy={busy} disabled={!url.trim() || (choice === 'pasted' && !phrase.trim())}>
          {busy ? 'Checking…' : 'Check and add'}
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => onDone('')}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

type Asking = 'rename' | 'remove' | null;

function AccountRow({ account, active, busy, run }: { account: Account; active: boolean; busy: boolean; run: (work: () => Promise<void>) => void }) {
  const [asking, setAsking] = useState<Asking>(null);
  const [draft, setDraft] = useState(account.name);
  const renaming = asking === 'rename';
  const removing = asking === 'remove';
  return (
    <li aria-label={account.name} data-account={account.name} data-id={account.id} className="flex flex-col gap-2 px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-[14px] font-medium">{account.name}</span>
          <span className="truncate text-[12px] text-muted">{account.backendUrl}</span>
        </span>
        {active ? (
          <Chip tone="done" icon="check">
            Active
          </Chip>
        ) : (
          <Button size="sm" disabled={busy} onClick={() => run(() => switchAccount(account.id))}>
            Switch to {account.name}
          </Button>
        )}
      </div>
      {renaming ? (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            run(async () => {
              await renameAccount(account.id, draft);
              setAsking(null);
            });
          }}
        >
          <label className="flex min-w-0 flex-1 flex-col gap-1 text-[13px] text-muted">
            New name
            <input className={inputClass} value={draft} disabled={busy} onChange={(event) => setDraft(event.target.value)} />
          </label>
          <Button type="submit" size="sm" variant="primary" disabled={busy || !draft.trim()}>
            Save name
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => setAsking(null)}>
            Cancel
          </Button>
        </form>
      ) : removing ? (
        <div className="flex flex-col gap-2 rounded-lg border border-line p-3">
          <p className="text-[13px]">Take “{account.name}” off this phone's list? Its key is not deleted.</p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="danger"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await removeAccount(account.id);
                  setAsking(null);
                })
              }
            >
              Yes, remove {account.name}
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setAsking(null)}>
              Keep it
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => {
              setDraft(account.name);
              setAsking('rename');
            }}
          >
            Rename {account.name}
          </Button>
          {/* The account in use is not removed from under him: switch away first. */}
          {!active && (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setAsking('remove')}>
              Remove {account.name}
            </Button>
          )}
        </div>
      )}
    </li>
  );
}

export function AccountsSection() {
  const { accounts, activeId } = useAccounts();
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string>();
  const [failed, setFailed] = useState<string>();
  const alive = useAlive();

  function run(work: () => Promise<void>) {
    setBusy(true);
    setFailed(undefined);
    work()
      .catch((err: unknown) => alive() && setFailed(words(err)))
      .finally(() => alive() && setBusy(false));
  }

  return (
    <section className="flex flex-col gap-2" aria-label="Accounts">
      <SectionTitle>Accounts</SectionTitle>
      <Card className="divide-y divide-line">
        <ul className="divide-y divide-line">
          {accounts.map((account) => (
            <AccountRow key={account.id} account={account} active={account.id === activeId} busy={busy} run={run} />
          ))}
        </ul>
        {said && (
          <p role="status" className="px-4 py-3 text-[13px] text-muted">
            {said}
          </p>
        )}
        {failed && (
          <p role="alert" className="px-4 py-3 text-[13px] text-danger">
            {failed}
          </p>
        )}
        {adding ? (
          <AddForm
            onDone={(line) => {
              setSaid(line || undefined);
              setAdding(false);
            }}
          />
        ) : (
          <div className="px-4 py-3">
            <Button
              size="sm"
              icon="plus"
              disabled={busy}
              onClick={() => {
                setSaid(undefined);
                setAdding(true);
              }}
            >
              Add account
            </Button>
          </div>
        )}
      </Card>
    </section>
  );
}

// src/key/IssueLicences.tsx — the issuer's half of the Key screen (docs/protocol.md §16, §19):
// Issue a licence (a holder's key scanned or pasted, a collection from /api/me, the cost against
// the balance) and Issued licences per collection with Revoke. Shown only for a cockpit key: an
// app key's /api/me names no collections, and then this renders nothing.
import { useCallback, useEffect, useRef, useState } from 'react';
import { plainMessage } from '../services/chainBusy';
import { fetchMe, type MeCollection } from '../services/me';
import { chain, type IssuedLicence, type IssuedLicenceEntry } from '../chain';
import { publicKeyHexFromMasterKey } from '../services/vault';
import { issuedTimes, rememberIssuedAt } from './issuedDates';
import { hasBarcodeDetector } from './barcode';
import { Scanner } from './Scanner';

const WHATSONCHAIN_TESTNET_TX_URL = 'https://test.whatsonchain.com/tx/';

const BUTTON =
  'inline-flex h-11 items-center justify-center rounded-xl border border-line bg-raised px-4 text-[15px] hover:border-line-strong disabled:opacity-45';
const PRIMARY_BUTTON =
  'inline-flex h-11 items-center justify-center rounded-xl bg-accent px-4 font-semibold text-accent-fg disabled:opacity-45';
const SMALL_BUTTON = 'inline-flex h-8 items-center rounded-lg border border-line bg-raised px-3 text-sm disabled:opacity-45';
/** Every error text wraps anywhere: a transaction id or a provider's words are one long word and would run off the edge. */
const WRAP = '[overflow-wrap:anywhere]';
const FIELD = 'h-11 rounded-xl border border-line bg-sunken px-3 text-[15px]';

type RowStatus = 'pending' | 'held' | 'revoked';

interface Row extends IssuedLicenceEntry {
  status: RowStatus;
}

/** A listing that failed while the rows are known (read before, or issued here) is 'retrying': the rows stay and it reads again by itself. */
type Listing =
  | { name: 'loading' }
  | { name: 'loaded'; entries: IssuedLicenceEntry[] }
  | { name: 'retrying'; entries: IssuedLicenceEntry[] }
  | { name: 'error'; message: string };

/** The wait before the first automatic re-read of a list that failed; it doubles each time. */
const LISTING_RETRY_MS = 2000;
const LISTING_RETRIES = 5;

type IssueOutcome = { name: 'idle' } | { name: 'issuing'; busy?: boolean } | { name: 'issued'; txid: string } | { name: 'error'; message: string };


const shorten = (text: string, head: number, tail: number) => (text.length > head + tail + 1 ? `${text.slice(0, head)}…${text.slice(-tail)}` : text);

const collectionLabel = (collection: MeCollection) => (collection.app ? `${collection.name} (${collection.app})` : collection.name);

const sats = (amount: number) => `${amount.toLocaleString('en-US')} sats`;

type Collections = { name: 'loading' } | { name: 'loaded'; collections: MeCollection[] } | { name: 'error' };

// Async loaders are kept free of setters and applied at the call site (.then(setter)).
const loadCollections = (key: Uint8Array): Promise<Collections> =>
  fetchMe({ key }).then(
    (me): Collections => ({ name: 'loaded', collections: me.collections ?? [] }),
    (): Collections => ({ name: 'error' }),
  );

const loadBalance = (key: Uint8Array): Promise<number | null> => chain.issuerBalance({ issuerKey: key }).catch(() => null);

const loadListing = (issuerPublicKeyHex: string): Promise<Listing> =>
  chain.issuedLicences({ issuerPublicKeyHex }).then(
    (entries): Listing => ({ name: 'loaded', entries }),
    (error): Listing => ({ name: 'error', message: plainMessage(error) }),
  );

function dateOf(row: Row, times: Record<string, number>): string {
  const at = times[row.txid];
  if (at) return `Issued ${new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`;
  return row.height === null ? 'Not in a block yet' : `Block ${row.height}`;
}

function IssuedRow({
  row,
  times,
  confirming,
  revoking,
  error,
  onAskRevoke,
  onCancel,
  onConfirm,
}: {
  row: Row;
  times: Record<string, number>;
  confirming: boolean;
  revoking: boolean;
  error: string | null;
  onAskRevoke: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <li data-testid="issued-row" className="flex flex-col gap-1 rounded-xl border border-line bg-raised p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span data-testid="issued-holder" className="font-mono" title={row.holder}>
          {shorten(row.holder, 6, 6)}
        </span>
        <span className={row.status === 'revoked' ? 'text-danger' : 'text-muted'}>{row.status}</span>
      </div>
      <div className="flex items-center justify-between gap-2 text-muted">
        <span>{dateOf(row, times)}</span>
        <a className="font-mono underline" href={`${WHATSONCHAIN_TESTNET_TX_URL}${row.txid}`}>
          {shorten(row.txid, 8, 6)}
        </a>
      </div>
      {row.status === 'held' && !confirming && (
        <button className={`${SMALL_BUTTON} self-start`} onClick={onAskRevoke}>
          Revoke
        </button>
      )}
      {confirming && (
        <div className="flex flex-col gap-2">
          <p>Revoke this licence?</p>
          <div className="flex gap-2">
            <button className={`${SMALL_BUTTON} text-danger`} disabled={revoking} onClick={onConfirm}>
              {revoking ? 'Revoking…' : 'Confirm revoke'}
            </button>
            <button className={SMALL_BUTTON} disabled={revoking} onClick={onCancel}>
              Cancel
            </button>
          </div>
          {error && (
            <p role="alert" className={`text-danger ${WRAP}`}>
              {error}
            </p>
          )}
        </div>
      )}
    </li>
  );
}

export function IssueLicences({ issuerKey }: { issuerKey: Uint8Array }) {
  const issuerPublicKeyHex = publicKeyHexFromMasterKey(issuerKey);
  const [collectionsState, setCollectionsState] = useState<Collections>({ name: 'loading' });
  const [collectionsToken, setCollectionsToken] = useState(0);
  const [balance, setBalance] = useState<number | null | undefined>(undefined);
  const [listing, setListing] = useState<Listing>({ name: 'loading' });
  const [times, setTimes] = useState<Record<string, number>>({});
  const [refreshToken, setRefreshToken] = useState(0);
  // What the list last read, and how many reads in a row failed since: a failed re-read keeps the rows.
  const knownEntries = useRef<IssuedLicenceEntry[]>([]);
  const issuedHere = useRef(0);
  const failedReads = useRef(0);

  const [holder, setHolder] = useState('');
  const [chosen, setChosen] = useState('');
  const [scanning, setScanning] = useState(false);
  const [confirmingIssue, setConfirmingIssue] = useState(false);
  const [outcome, setOutcome] = useState<IssueOutcome>({ name: 'idle' });
  const [justIssued, setJustIssued] = useState<IssuedLicence[]>([]);
  const [revokedHere, setRevokedHere] = useState<string[]>([]);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [revokeError, setRevokeError] = useState<{ origin: string; message: string } | null>(null);
  const [addressCopied, setAddressCopied] = useState<'idle' | 'copied' | 'unavailable'>('idle');
  // A second tap in the tick before the first one's re-render must not build a second mint.
  const issueInFlight = useRef(false);

  useEffect(() => {
    void loadCollections(issuerKey).then(setCollectionsState);
  }, [issuerKey, collectionsToken]);

  const collections = collectionsState.name === 'loaded' ? collectionsState.collections : [];
  const enabled = collections.length > 0;

  useEffect(() => {
    if (!enabled) return;
    let current = true;
    void loadBalance(issuerKey).then(setBalance);
    void loadListing(issuerPublicKeyHex).then((next) => {
      // A read that a newer one has replaced says nothing more.
      if (!current) return;
      if (next.name === 'loaded') {
        knownEntries.current = next.entries;
        failedReads.current = 0;
        setListing(next);
        return;
      }
      failedReads.current += 1;
      const rowsKnown = knownEntries.current.length > 0 || issuedHere.current > 0;
      setListing(rowsKnown && failedReads.current <= LISTING_RETRIES ? { name: 'retrying', entries: knownEntries.current } : next);
    });
    void issuedTimes().then(setTimes);
    return () => {
      current = false;
    };
  }, [enabled, issuerKey, issuerPublicKeyHex, refreshToken]);

  useEffect(() => {
    if (listing.name !== 'retrying') return;
    const timer = setTimeout(() => setRefreshToken((token) => token + 1), LISTING_RETRY_MS * 2 ** (failedReads.current - 1));
    return () => clearTimeout(timer);
  }, [listing]);

  const handleRead = useCallback((text: string) => {
    setHolder(text.trim());
    setScanning(false);
  }, []);
  const handleCancelScan = useCallback(() => setScanning(false), []);

  if (collectionsState.name === 'error') {
    return (
      <section className="flex flex-col gap-2 border-t border-line pt-4">
        <p role="alert" className={`text-danger ${WRAP}`}>
          Could not read the collections.
        </p>
        <button
          className={`${BUTTON} self-start`}
          onClick={() => {
            setCollectionsState({ name: 'loading' });
            setCollectionsToken((token) => token + 1);
          }}
        >
          Retry
        </button>
      </section>
    );
  }
  if (!enabled) return null;

  const cost = chain.issueCost();
  const collection = collections.some((c) => c.name === chosen) ? chosen : collections[0].name;

  const short = typeof balance === 'number' && balance < cost.totalSatoshis;
  const fundingAddress = chain.addressFor(issuerPublicKeyHex);

  async function handleCopyAddress() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard API not available');
      await navigator.clipboard.writeText(fundingAddress);
      setAddressCopied('copied');
      setTimeout(() => setAddressCopied('idle'), 3000);
    } catch {
      setAddressCopied('unavailable');
    }
  }

  async function handleIssue() {
    if (issueInFlight.current) return;
    issueInFlight.current = true;
    setOutcome({ name: 'issuing' });
    try {
      const issued = await chain.issueLicence({
        issuerKey,
        holderPublicKeyHex: holder,
        collection,
        onBusy: () => setOutcome({ name: 'issuing', busy: true }),
      });
      await rememberIssuedAt(issued.txid);
      issuedHere.current += 1;
      setJustIssued((previous) => [...previous, issued]);
      setOutcome({ name: 'issued', txid: issued.txid });
      setHolder('');
      setRefreshToken((token) => token + 1);
    } catch (error) {
      setOutcome({ name: 'error', message: plainMessage(error) });
    } finally {
      issueInFlight.current = false;
      setConfirmingIssue(false);
    }
  }

  async function handleRevoke(origin: string) {
    setRevoking(origin);
    setRevokeError(null);
    try {
      await chain.revokeLicence({ issuerKey, origin });
      setRevokedHere((previous) => [...previous, origin]);
      setConfirming(null);
      setRefreshToken((token) => token + 1);
    } catch (error) {
      setRevokeError({ origin, message: plainMessage(error) });
    } finally {
      setRevoking(null);
    }
  }

  const entries = listing.name === 'loaded' || listing.name === 'retrying' ? listing.entries : [];
  const listed = new Set(entries.map((entry) => entry.origin));
  const pendingRows: IssuedLicenceEntry[] = justIssued
    .filter((issued) => !listed.has(issued.origin))
    .map((issued) => ({ ...issued, height: null, revoked: false }));
  const rows: Row[] = [...pendingRows, ...entries].map((entry) => ({
    ...entry,
    status: entry.revoked || revokedHere.includes(entry.origin) ? 'revoked' : pendingRows.includes(entry) ? 'pending' : 'held',
  }));
  const groups = [...new Set(rows.map((row) => row.collection))].map((name) => ({
    name,
    rows: rows.filter((row) => row.collection === name),
  }));

  return (
    <>
      <section aria-label="Issue a licence" className="flex flex-col gap-2 border-t border-line pt-4">
        <h2 className="text-lg font-semibold">Issue a licence</h2>
        <label htmlFor="holder-key">Holder&apos;s public key</label>
        <input
          id="holder-key"
          className={`${FIELD} font-mono`}
          value={holder}
          autoComplete="off"
          spellCheck={false}
          placeholder="02… or 03… (66 hex characters)"
          onChange={(e) => setHolder(e.target.value)}
        />
        {hasBarcodeDetector() && !scanning && (
          <button className={`${BUTTON} self-start`} onClick={() => setScanning(true)}>
            Scan
          </button>
        )}
        {scanning && <Scanner onRead={handleRead} onCancel={handleCancelScan} />}

        <label htmlFor="issue-collection">Collection</label>
        <select id="issue-collection" className={FIELD} value={collection} onChange={(e) => setChosen(e.target.value)}>
          {collections.map((c) => (
            <option key={c.name} value={c.name}>
              {collectionLabel(c)}
            </option>
          ))}
        </select>

        <p data-testid="issue-cost" className="text-sm text-muted">
          Cost: {sats(cost.fuelSatoshis)} mint fuel + about {sats(cost.feeEstimateSatoshis)} fee.{' '}
          {balance === undefined ? 'Checking balance…' : balance === null ? 'Balance unavailable.' : `Balance: ${sats(balance)}.`}
        </p>
        {short && (
          <div className="flex flex-col gap-2">
            <p role="alert" className={`text-danger ${WRAP}`}>
              Not enough sats: this needs {cost.totalSatoshis.toLocaleString('en-US')}, you have {balance.toLocaleString('en-US')}.
            </p>
            <p className="text-sm text-muted">
              Send testnet sats to this key&apos;s address:{' '}
              <span data-testid="fund-address" className="break-all font-mono">
                {fundingAddress}
              </span>
            </p>
            <button className={`${BUTTON} self-start`} onClick={() => void handleCopyAddress()}>
              {addressCopied === 'copied' ? 'Copied' : 'Copy funding address'}
            </button>
            {addressCopied === 'unavailable' && <p className="text-sm">Copy is not available here: select the address by hand</p>}
          </div>
        )}
        {!confirmingIssue && (
          <button className={PRIMARY_BUTTON} disabled={!holder.trim() || short} onClick={() => setConfirmingIssue(true)}>
            Issue
          </button>
        )}
        {confirmingIssue && !short && (
          <div className="flex flex-col gap-2">
            <p>
              Issue a licence to {shorten(holder.trim(), 8, 6)} in {collection}? Cost about {sats(cost.totalSatoshis)}.
            </p>
            <div className="flex gap-2">
              <button className={PRIMARY_BUTTON} disabled={outcome.name === 'issuing'} onClick={() => void handleIssue()}>
                {outcome.name === 'issuing' ? 'Issuing…' : 'Confirm issue'}
              </button>
              <button className={BUTTON} disabled={outcome.name === 'issuing'} onClick={() => setConfirmingIssue(false)}>
                Cancel
              </button>
            </div>
          </div>
        )}
        {outcome.name === 'issuing' && outcome.busy && (
          <p role="status" className="text-sm text-muted">
            WhatsOnChain is busy, trying again…
          </p>
        )}
        {outcome.name === 'issued' && (
          <p>
            Issued:{' '}
            <a className="break-all font-mono underline" href={`${WHATSONCHAIN_TESTNET_TX_URL}${outcome.txid}`}>
              {outcome.txid}
            </a>
          </p>
        )}
        {outcome.name === 'error' && (
          <p role="alert" className={`text-danger ${WRAP}`}>
            {outcome.message}
          </p>
        )}
      </section>

      <section aria-label="Issued licences" className="flex flex-col gap-2 border-t border-line pt-4">
        <h2 className="text-lg font-semibold">Issued licences</h2>
        {listing.name === 'loading' && <p className="text-sm text-muted">Reading the chain…</p>}
        {listing.name === 'retrying' && <p className="text-sm text-muted">Could not reach the chain just now. Reading again…</p>}
        {listing.name === 'error' && (
          <div className="flex flex-col gap-2">
            <p role="alert" className={`text-danger ${WRAP}`}>
              The issued licences could not be read. Check the connection and try again.
            </p>
            <p className={`text-sm text-muted ${WRAP}`}>{listing.message}</p>
            <button
              className={`${BUTTON} self-start`}
              onClick={() => {
                failedReads.current = 0;
                setListing({ name: 'loading' });
                setRefreshToken((token) => token + 1);
              }}
            >
              Retry
            </button>
          </div>
        )}
        {listing.name === 'loaded' && rows.length === 0 && <p className="text-sm text-muted">No licence issued from this key yet.</p>}
        {groups.map((group) => (
          <div key={group.name} data-testid="issued-group" className="flex flex-col gap-2">
            <h3 className="font-semibold">{group.name}</h3>
            <ul className="flex flex-col gap-2">
              {group.rows.map((row) => (
                <IssuedRow
                  key={row.origin}
                  row={row}
                  times={times}
                  confirming={confirming === row.origin}
                  revoking={revoking === row.origin}
                  error={revokeError?.origin === row.origin ? revokeError.message : null}
                  onAskRevoke={() => {
                    setRevokeError(null);
                    setConfirming(row.origin);
                  }}
                  onCancel={() => setConfirming(null)}
                  onConfirm={() => void handleRevoke(row.origin)}
                />
              ))}
            </ul>
          </div>
        ))}
      </section>
    </>
  );
}

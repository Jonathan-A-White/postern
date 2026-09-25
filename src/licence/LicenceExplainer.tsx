// src/licence/LicenceExplainer.tsx — the one place the "what is a licence?" copy lives,
// rendered on both the gate's no-licence state (src/gate/Gate.tsx) and the key screen's
// mint block (src/key/KeyVault.tsx), so a person who installs the PWA cold is not asked
// to mint a licence without knowing what that means (mw-1589l.26).
import { mintCostSatoshis } from '../services/mint';

export function LicenceExplainer() {
  const cost = mintCostSatoshis().toLocaleString('en-US');

  return (
    <details className="max-w-sm text-left text-sm text-slate-400">
      <summary className="cursor-pointer underline">What is a licence?</summary>
      <div className="mt-2 flex flex-col gap-2">
        <p>
          A licence is a small token recorded on the BSV chain (testnet today), locked to
          your own key. It is the proof of who you are to your Mayor, and the lock on the
          door: only a key holding one opens Postern&apos;s gate.
        </p>
        <p>
          Minting one is a single transaction, paid from your own key: {cost} testnet sats
          today, the token plus the fee. The app proves you hold a licence by reading the
          chain itself, so no server decides who is let in.
        </p>
        <p>
          Your key lives on this phone, unlocked by your fingerprint and backed up as
          twelve words. Whoever holds the key holds the licence, and that same key signs
          and decrypts every message you send and receive.
        </p>
      </div>
    </details>
  );
}

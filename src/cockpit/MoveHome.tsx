// src/cockpit/MoveHome.tsx — the one tap that moves the factory's home
// (mw-43v9x.9, Q2): a button per host, one confirm, then a move-home message
// through the normal send path. Used by the Me screen's Home row and by the
// shell's 'Home is down' offer.
import { useState } from 'react';
import { Button } from '../ui';
import type { HomeHost } from '../services/standby';
import { sendMoveHome, useSend } from './send';

export function MoveHomeButtons({ hosts, current }: { hosts: readonly HomeHost[]; current?: string }) {
  const { busy, run } = useSend();
  const [asking, setAsking] = useState<HomeHost | null>(null);

  async function move(host: HomeHost) {
    await run(() => sendMoveHome(host), `Asked the Mayor to move the home to ${host}`);
    setAsking(null);
  }

  if (asking) {
    return (
      <div className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-2.5" role="group" aria-label="Confirm">
        <p className="text-[13px]">{`Move the factory's home to ${asking}? The Mayor there takes over.`}</p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="primary" busy={busy} onClick={() => void move(asking)}>
            Move home
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setAsking(null)}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap gap-2">
      {hosts.map((host) => (
        <Button key={host} size="sm" icon="host" disabled={host === current} onClick={() => setAsking(host)}>
          {`Move home to ${host}`}
        </Button>
      ))}
    </div>
  );
}

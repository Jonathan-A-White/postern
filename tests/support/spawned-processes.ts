// tests/support/spawned-processes.ts — mw-gq6.489: processes a test spawns, and ending them for good.
// A spawned wrapper (the preview guard, `sh -c`, npx) starts its own child; killing only the wrapper
// leaves that grandchild running under init, holding its port. spawnTracked starts each process as the
// leader of its own group, and killSpawned ends the whole group.
import { spawn, type ChildProcess } from 'node:child_process';

const tracked: ChildProcess[] = [];

export function spawnTracked(command: string, args: string[]): ChildProcess {
  const child = spawn(command, args, { stdio: 'ignore', detached: true });
  tracked.push(child);
  return child;
}

export function killSpawned(): void {
  for (const child of tracked.splice(0)) {
    try {
      if (child.pid !== undefined) process.kill(-child.pid, 'SIGKILL');
    } catch {
      /* the group is already gone */
    }
  }
}

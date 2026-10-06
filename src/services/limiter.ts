// src/services/limiter.ts — at most `max` tasks run at once; the rest wait their turn in order.
// A task is started (so whatever it does first, such as signing a challenge, happens) only
// when it leaves the queue, never before.
export interface Limiter {
  run<T>(task: () => Promise<T>): Promise<T>;
}

export function createLimiter(max: number): Limiter {
  let running = 0;
  const queue: (() => void)[] = [];

  function next(): void {
    if (running >= max) return;
    queue.shift()?.();
  }

  return {
    run<T>(task: () => Promise<T>): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        const start = () => {
          running += 1;
          let work: Promise<T>;
          try {
            work = Promise.resolve(task());
          } catch (err) {
            work = Promise.reject(err);
          }
          work.then(resolve, reject).finally(() => {
            running -= 1;
            next();
          });
        };
        queue.push(start);
        next();
      });
    },
  };
}

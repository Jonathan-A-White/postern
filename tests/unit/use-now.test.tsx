// useNow (mw-xhtcup.1): one shared clock per interval for every TimeAgo, asleep while the
// page is hidden. Fake timers; setInterval/clearInterval are spied on rather than counted with
// vi.getTimerCount(), because vitest 4 fakes setImmediate, which React 19's scheduler uses.
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TimeAgo } from '../../src/ui/primitives';

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

const START = new Date('2026-10-07T12:00:00Z').getTime();

describe('useNow through TimeAgo', () => {
  let setIntervalSpy: ReturnType<typeof vi.spyOn>;
  let clearIntervalSpy: ReturnType<typeof vi.spyOn>;
  let renders: number;

  function Counted({ at }: { at: number }) {
    renders += 1;
    return <TimeAgo at={at} />;
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    vi.setSystemTime(START);
    setVisibility('visible');
    setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');
    renders = 0;
  });
  afterEach(() => {
    cleanup();
    setIntervalSpy.mockRestore();
    clearIntervalSpy.mockRestore();
    setVisibility('visible');
    vi.useRealTimers();
  });

  it('20 mounted TimeAgo share one interval, cleared once after the last unmount', () => {
    const { unmount } = render(
      <>
        {Array.from({ length: 20 }, (_, i) => (
          <TimeAgo key={i} at={START - 60_000} />
        ))}
      </>,
    );
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    expect(clearIntervalSpy).not.toHaveBeenCalled();
    unmount();
    expect(clearIntervalSpy).toHaveBeenCalledTimes(1);
  });

  it('reads 1 min ago for now-60s, and 3 min ago after 120 s more', () => {
    render(<TimeAgo at={START - 60_000} />);
    expect(screen.getByText('1 min ago')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(120_000);
    });
    expect(screen.getByText('3 min ago')).toBeInTheDocument();
  });

  it('hidden: no timer is left and five minutes of fake time re-render nothing', () => {
    render(<Counted at={START - 60_000} />);
    setIntervalSpy.mockClear();
    clearIntervalSpy.mockClear();
    setVisibility('hidden');
    expect(clearIntervalSpy).toHaveBeenCalledTimes(1);
    const before = renders;
    act(() => {
      vi.advanceTimersByTime(5 * 60_000);
    });
    expect(renders).toBe(before);
    expect(setIntervalSpy).not.toHaveBeenCalled();
    expect(screen.getByText('1 min ago')).toBeInTheDocument();
  });

  it('visible again: the label is fresh at once and the timer is back, once', () => {
    render(<TimeAgo at={START - 60_000} />);
    setVisibility('hidden');
    act(() => {
      vi.advanceTimersByTime(5 * 60_000);
    });
    expect(screen.getByText('1 min ago')).toBeInTheDocument();
    setIntervalSpy.mockClear();
    setVisibility('visible');
    expect(screen.getByText('6 min ago')).toBeInTheDocument();
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByText('7 min ago')).toBeInTheDocument();
  });

  it('mounted while hidden starts stopped, and wakes on visible', () => {
    setVisibility('hidden');
    setIntervalSpy.mockClear();
    render(<TimeAgo at={START - 60_000} />);
    expect(setIntervalSpy).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(5 * 60_000);
    });
    setVisibility('visible');
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByText('6 min ago')).toBeInTheDocument();
  });

  it('after the last unmount the interval is cleared and the visibilitychange listener removed', () => {
    const add = vi.spyOn(document, 'addEventListener');
    const remove = vi.spyOn(document, 'removeEventListener');
    const { unmount } = render(<TimeAgo at={START} />);
    const added = add.mock.calls.filter(([type]) => type === 'visibilitychange');
    expect(added).toHaveLength(1);
    unmount();
    expect(clearIntervalSpy).toHaveBeenCalledTimes(1);
    expect(remove.mock.calls.filter(([type, fn]) => type === 'visibilitychange' && fn === added[0][1])).toHaveLength(1);
    add.mockRestore();
    remove.mockRestore();
  });
});

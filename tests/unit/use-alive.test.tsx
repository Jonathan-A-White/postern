import { describe, it, expect } from 'vitest';
import { useEffect } from 'react';
import { render } from '@testing-library/react';
import { useAlive } from '../../src/ui';

describe('useAlive (mw-ev7oyy.21)', () => {
  it('is true from the first render, for a child mount effect too, and false once the component is gone', () => {
    let alive: () => boolean = () => false;
    let seenByChild: boolean | undefined;
    function Child({ ask }: { ask: () => boolean }) {
      useEffect(() => {
        seenByChild = ask();
      }, [ask]);
      return null;
    }
    function Parent() {
      alive = useAlive();
      return <Child ask={alive} />;
    }
    const { unmount } = render(<Parent />);
    expect(seenByChild).toBe(true);
    expect(alive()).toBe(true);
    unmount();
    expect(alive()).toBe(false);
  });
});

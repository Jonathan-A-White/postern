import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { App } from '../../src/App';

describe('App', () => {
  afterEach(() => {
    cleanup();
    window.history.pushState({}, '', '/');
  });

  it('shows the gate at the root path', () => {
    render(<App />);
    expect(screen.getByText('The gate is locked')).toBeInTheDocument();
  });

  it('shows the key vault when ?screen=key is present', () => {
    window.history.pushState({}, '', '/?screen=key');
    render(<App />);
    expect(screen.getByText('The key vault')).toBeInTheDocument();
  });
});

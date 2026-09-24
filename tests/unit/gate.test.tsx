import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Gate } from '../../src/gate';

describe('Gate', () => {
  it('renders the app name and the locked message', () => {
    render(<Gate />);
    expect(screen.getByText('The gate is locked')).toBeInTheDocument();
    expect(screen.getByText('Postern')).toBeInTheDocument();
  });

  it('renders the app version', () => {
    render(<Gate />);
    expect(screen.getByText(__APP_VERSION__, { exact: false })).toBeInTheDocument();
  });
});

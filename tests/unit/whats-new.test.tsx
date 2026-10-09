// tests/unit/whats-new.test.tsx — mw-s061bg.3: What's new comes from bsv-kit's packages/whats-new, pinned at a commit
// that holds it; the version Postern passes it is the package version; the link follows the repo's visibility.
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { summarise } from 'bsv-kit/whats-new';
import { MeScreen } from '../../src/cockpit/MeScreen';
import { APP_VERSION, REPO, changelogLink } from '../../src/services/whatsNew';
import { changelogFixture, stubChangelog, WAITING_VERSION } from '../support/changelog-fixture';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the version What\'s new is given', () => {
  it('is the package version, without the build time and commit', () => {
    expect(APP_VERSION).toBe(__APP_VERSION__.split(' · ')[0]);
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('links to the version\'s heading in CHANGELOG.md on GitHub while the repo is public', () => {
    expect(REPO).toBe('Jonathan-A-White/postern');
    expect(changelogLink('0.5.11')).toBe('https://github.com/Jonathan-A-White/postern/blob/main/CHANGELOG.md#0511');
  });
});

describe('the summary of a waiting build', () => {
  it('counts the lines of every version after the running one, and 0.5.10 is after 0.5.9', () => {
    const summary = summarise(changelogFixture(), APP_VERSION);
    expect(summary?.bannerText).toBe(`${WAITING_VERSION} · 2 new, 1 fixed · What's new`);
    const later = [{ version: '0.5.10', date: '2026-10-09', story: 'x', kind: 'new' as const, text: 'Later' }];
    expect(summarise(later, '0.5.9')?.version).toBe('0.5.10');
    expect(summarise(later, '0.5.10')).toBeNull();
  });
});

describe('Me', () => {
  it('shows the version as a link to its heading in CHANGELOG.md', async () => {
    stubChangelog(changelogFixture());
    render(<MeScreen />);
    const link = await screen.findByRole('link', { name: APP_VERSION });
    expect(link).toHaveAttribute('href', changelogLink(APP_VERSION));
    expect(link).toHaveAttribute('target', '_blank');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Reset to defaults' })).toBeInTheDocument());
  });
});

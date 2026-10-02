// mw-gq6.196: Postern's version string changes with every build, so he can tell on his
// phone whether the new build has loaded: '<package version> · <UTC date time>Z · <commit>'.
import '@testing-library/react/dont-cleanup-after-each';
import { afterAll, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildVersion, shortCommit } from '../../build-version';
import { describeBuild } from '../../src/services/buildLine';
import { MeScreen } from '../../src/cockpit/MeScreen';
import { Welcome } from '../../src/cockpit/Gate';

afterAll(() => cleanup());

describe('buildVersion', () => {
  it('joins the package version, the UTC build time and the short commit', () => {
    const when = new Date(Date.UTC(2026, 9, 1, 16, 5, 59));
    expect(buildVersion('0.1.0', when, 'abc1234')).toBe('0.1.0 · 2026-10-01 16:05Z · abc1234');
  });

  it('gives two different strings for two commits and for two build times', () => {
    const t = new Date(Date.UTC(2026, 9, 1, 16, 5));
    expect(buildVersion('0.1.0', t, 'abc1234')).not.toBe(buildVersion('0.1.0', t, 'def5678'));
    expect(buildVersion('0.1.0', t, 'abc1234')).not.toBe(buildVersion('0.1.0', new Date(t.getTime() + 60_000), 'abc1234'));
  });
});

describe('shortCommit', () => {
  it("is this checkout's short HEAD inside a git checkout", () => {
    const head = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf-8' }).trim();
    expect(shortCommit(process.cwd())).toBe(head);
  });

  it("is 'dev' outside a git checkout, and never throws", () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'postern-nogit-'));
    try {
      expect(shortCommit(dir)).toBe('dev');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("is 'dev' when git itself is absent", () => {
    expect(shortCommit(process.cwd(), '/nonexistent/git')).toBe('dev');
  });
});

describe('describeBuild', () => {
  it('splits the version string into the build line and the package version', () => {
    expect(describeBuild('0.1.0 · 2026-10-02 12:53Z · 242e766')).toEqual({ build: 'Build 2026-10-02 12:53Z · 242e766', version: '0.1.0' });
  });

  it('keeps a string it cannot split whole rather than showing nothing', () => {
    expect(describeBuild('whatever')).toEqual({ build: 'Build whatever', version: '' });
  });
});

describe('the version the app shows', () => {
  const shape = /^\d+\.\d+\.\d+ · \d{4}-\d{2}-\d{2} \d{2}:\d{2}Z · ([0-9a-f]{7,}|dev)$/;

  it('__APP_VERSION__ holds the version, the build time and the commit', () => {
    expect(__APP_VERSION__).toMatch(shape);
    expect(__APP_VERSION__).toContain(shortCommit(process.cwd()));
  });

  it('Me opens with the build time and commit, then the package version smaller', async () => {
    render(<MeScreen />);
    const [version, built, commit] = __APP_VERSION__.split(' · ');
    const line = await screen.findByLabelText('Build');
    expect(line.firstElementChild).toHaveTextContent(`Build ${built} · ${commit}`);
    expect(line.lastElementChild).toHaveTextContent(version);
    // Let the screen's own reads land before it goes, so none outlives the test (mw-j0f2d.42).
    await waitFor(() => expect(screen.getByRole('button', { name: 'Reset to defaults' })).toBeInTheDocument());
    cleanup();
  });

  it('the gate shows the same version', () => {
    render(<Welcome />);
    expect(screen.getByText(`v${__APP_VERSION__}`)).toBeInTheDocument();
  });
});

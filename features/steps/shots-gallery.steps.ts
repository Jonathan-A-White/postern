// features/steps/shots-gallery.steps.ts — runs features/shots-gallery.feature: the pure functions
// behind `npm run shots:publish -- latest` (scripts/shots-gallery.mjs).
import { expect } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { buildIndexHtml, buildManifest, shouldCommit } from '../../scripts/shots-gallery.mjs';

const feature = await loadFeature('features/shots-gallery.feature');

describeFeature(feature, ({ Scenario }) => {
  Scenario('AC-1: the manifest names every png with its screen, size and address', ({ Given, When, Then, And }) => {
    let names: string[] = [];
    let manifest: ReturnType<typeof buildManifest>;
    Given('the png names "390x844/gate.png", "360x640/gate.png" and "1280x800/gate.png"', () => {
      names = ['390x844/gate.png', '360x640/gate.png', '1280x800/gate.png'];
    });
    When('the manifest is built for version "0.5.35" and commit "abc1234"', () => {
      manifest = buildManifest({ names, version: '0.5.35', commit: 'abc1234', publishedAt: '2026-10-10T12:00:00.000Z' });
    });
    Then('it lists three files, each with its name, screen, width, height and url', () => {
      expect(manifest.version).toBe('0.5.35');
      expect(manifest.commit).toBe('abc1234');
      expect(manifest.published_at).toBe('2026-10-10T12:00:00.000Z');
      expect(manifest.files).toHaveLength(3);
      for (const f of manifest.files) {
        expect(Object.keys(f).sort()).toEqual(['height', 'name', 'screen', 'url', 'width']);
      }
    });
    And('the 360x640 file reads screen "gate", width 360, height 640', () => {
      const f = manifest.files.find((x) => x.name === '360x640/gate.png');
      expect(f).toMatchObject({ screen: 'gate', width: 360, height: 640 });
    });
    And('its url is the raw.githubusercontent.com address under shots/latest/', () => {
      const f = manifest.files.find((x) => x.name === '360x640/gate.png');
      expect(f?.url).toBe('https://raw.githubusercontent.com/Jonathan-A-White/postern/shots/latest/360x640/gate.png');
    });
  });

  Scenario('AC-1: the gallery names each screen once with its three sizes side by side', ({ Given, When, Then, And }) => {
    let names: string[] = [];
    let html = '';
    Given(
      'the png names "390x844/gate.png", "360x640/gate.png", "1280x800/gate.png", "390x844/about.png", "360x640/about.png" and "1280x800/about.png"',
      () => {
        names = ['390x844/gate.png', '360x640/gate.png', '1280x800/gate.png', '390x844/about.png', '360x640/about.png', '1280x800/about.png'];
      },
    );
    When('the gallery page is built', () => {
      html = buildIndexHtml({ names, version: '0.5.35' });
    });
    Then('each screen appears once, in name order', () => {
      const headings = [...html.matchAll(/<h2>([^<]*)<\/h2>/g)].map((m) => m[1]);
      expect(headings).toEqual(['about', 'gate']);
    });
    And('each screen shows its three sizes, each linking to the full png', () => {
      for (const name of names) {
        expect(html).toContain(`<a href="${name}">`);
      }
      expect(html.match(/<img /g)).toHaveLength(6);
    });
  });

  Scenario('AC-1: a screen name with markup in it cannot break the gallery', ({ Given, When, Then }) => {
    let names: string[] = [];
    let html = '';
    Given('the png names "390x844/a<b>&c.png"', () => {
      names = ['390x844/a<b>&c.png'];
    });
    When('the gallery page is built', () => {
      html = buildIndexHtml({ names, version: '0.5.35' });
    });
    Then('the page holds the name escaped and no raw tag from it', () => {
      expect(html).not.toContain('<b>');
      expect(html).toContain('a&lt;b&gt;&amp;c');
    });
  });

  Scenario('AC-7: a publish that changed no file adds no commit', ({ Given, When, Then }) => {
    let status = '';
    let decision = true;
    Given('the shots branch already holds the same latest/ set', () => {
      status = '';
    });
    When('the publish asks whether to commit', () => {
      decision = shouldCommit(status);
    });
    Then('it skips and nothing is pushed', () => {
      expect(decision).toBe(false);
    });
  });

  Scenario('AC-7: a publish that changed a file adds one commit', ({ Given, When, Then }) => {
    let status = '';
    let decision = false;
    Given('the shots branch holds an older latest/ set', () => {
      status = 'M  latest/390x844/gate.png\n';
    });
    When('the publish asks whether to commit', () => {
      decision = shouldCommit(status);
    });
    Then('it commits', () => {
      expect(decision).toBe(true);
    });
  });
});

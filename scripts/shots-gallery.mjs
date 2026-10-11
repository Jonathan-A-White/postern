// scripts/shots-gallery.mjs — mw-s6387p.1: the pure parts of `npm run shots:publish -- latest`,
// kept apart from the ssh/rsync/git plumbing so they are tested on their own: the manifest.json
// and index.html built from a list of png names ('<size>/<screen>.png'), and whether the
// 'shots' branch needs a new commit.

// The sizes every e2e shot is taken at (tests/e2e/shot.ts): phone first.
export const SHOT_SIZES = [
  { name: '390x844', width: 390, height: 844 },
  { name: '360x640', width: 360, height: 640 },
  { name: '1280x800', width: 1280, height: 800 },
];

// His work Space's proxy blocks allmymind.org but lets raw.githubusercontent.com through, so the
// manifest points at the GitHub copy of each file.
export const RAW_BASE = 'https://raw.githubusercontent.com/Jonathan-A-White/postern/shots/latest';

const NAME_PATTERN = /^(\d+)x(\d+)\/(.+)\.png$/;

export function parseShotName(name) {
  const match = NAME_PATTERN.exec(name);
  if (!match) throw new Error(`Not a shot name with a size folder: ${name} (expected <width>x<height>/<screen>.png)`);
  return { size: `${match[1]}x${match[2]}`, width: Number(match[1]), height: Number(match[2]), screen: match[3] };
}

function sizeRank(size) {
  const at = SHOT_SIZES.findIndex((s) => s.name === size);
  return at === -1 ? SHOT_SIZES.length : at;
}

// Sorted by screen, then phone, small phone, desktop; other sizes last by name.
function ordered(names) {
  return names
    .map((name) => ({ name, ...parseShotName(name) }))
    .sort((a, b) => (a.screen < b.screen ? -1 : a.screen > b.screen ? 1 : sizeRank(a.size) - sizeRank(b.size) || (a.size < b.size ? -1 : a.size > b.size ? 1 : 0)));
}

function encodePath(name) {
  return name.split('/').map(encodeURIComponent).join('/');
}

export function buildManifest({ names, version, commit, publishedAt }) {
  return {
    version,
    commit,
    published_at: publishedAt,
    files: ordered(names).map(({ name, screen, width, height }) => ({
      name,
      screen,
      width,
      height,
      url: `${RAW_BASE}/${encodePath(name)}`,
    })),
  };
}

// A publish that changes no screen leaves manifest.json byte for byte as it was: the old
// published_at is kept when everything else in the manifest is the same.
export function stabiliseManifest(manifest, previousText) {
  if (!previousText) return manifest;
  let previous;
  try {
    previous = JSON.parse(previousText);
  } catch {
    return manifest;
  }
  if (!previous || typeof previous.published_at !== 'string') return manifest;
  const same = JSON.stringify({ ...previous, published_at: '' }) === JSON.stringify({ ...manifest, published_at: '' });
  return same ? { ...manifest, published_at: previous.published_at } : manifest;
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function buildIndexHtml({ names, version }) {
  const byScreen = new Map();
  for (const shot of ordered(names)) {
    if (!byScreen.has(shot.screen)) byScreen.set(shot.screen, []);
    byScreen.get(shot.screen).push(shot);
  }
  const sections = [...byScreen.entries()].map(([screen, shots]) => {
    const figures = shots
      .map((shot) => {
        const href = escapeHtml(encodePath(shot.name));
        return `<figure><a href="${href}"><img src="${href}" alt="${escapeHtml(screen)} at ${escapeHtml(shot.size)}" loading="lazy"></a><figcaption>${escapeHtml(shot.size)}</figcaption></figure>`;
      })
      .join('\n      ');
    return `  <section>\n    <h2>${escapeHtml(screen)}</h2>\n    <div class="row">\n      ${figures}\n    </div>\n  </section>`;
  });
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Postern screens</title>
<style>
  body { font: 16px/1.4 system-ui, sans-serif; margin: 1rem; background: #111; color: #eee; }
  a { color: #8cf; }
  .row { display: flex; gap: 1rem; align-items: flex-start; overflow-x: auto; }
  figure { margin: 0; flex: none; }
  img { display: block; max-height: 70vh; width: auto; max-width: none; border: 1px solid #444; }
  figcaption { font-size: .85rem; color: #aaa; }
</style>
</head>
<body>
  <h1>Postern screens</h1>
  <p>Version ${escapeHtml(version)}. Every screen at 390x844, 360x640 and 1280x800. <a href="manifest.json">manifest.json</a></p>
${sections.join('\n')}
</body>
</html>
`;
}

// `git status --porcelain` after the new set was copied over latest/ and added: any line is a change.
export function shouldCommit(porcelainStatus) {
  return porcelainStatus.split('\n').some((line) => line.trim() !== '');
}

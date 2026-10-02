// src/services/buildLine.ts — Me's first line (mw-yxwtth.1): the build's UTC time and commit, which
// tell him which build is on his phone, and the package version, which never changes, smaller.

/** Splits build-version.ts's '<version> · <UTC time> · <commit>' into the build line and the version. */
export function describeBuild(stamp: string): { build: string; version: string } {
  const [version, built, commit] = stamp.split(' · ');
  if (!built) return { build: `Build ${stamp}`, version: '' };
  return { build: `Build ${built}${commit ? ` · ${commit}` : ''}`, version };
}

// src/ui/Icon.tsx — the cockpit's one icon set: 24×24 stroke glyphs drawn inline,
// so the app ships no icon font or dependency and every icon follows the text
// colour (currentColor) of wherever it sits.
import type { SVGProps } from 'react';

const PATHS = {
  needs: 'M12 3a6 6 0 0 0-6 6v3.5L4.5 15.5h15L18 12.5V9a6 6 0 0 0-6-6ZM9.5 18.5a2.5 2.5 0 0 0 5 0',
  map: 'M9 4 3.5 6v14L9 18l6 2 5.5-2V4L15 6 9 4Zm0 0v14m6-12v14',
  talk: 'M20 12a7.5 7.5 0 0 1-11.2 6.5L4 20l1.5-4.3A7.5 7.5 0 1 1 20 12Z',
  search: 'm20 20-4.2-4.2M17 10.5a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0Z',
  me: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7.5 8a7.5 7.5 0 0 1 15 0',
  lock: 'M7 11V8a5 5 0 0 1 10 0v3M6 11h12v9H6v-9Z',
  key: 'M8.5 20.5a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm3.5-8.5 8.5-8.5m-3 3 2.5 2.5m-5.5.5 2 2',
  fingerprint:
    'M7.5 18.5c1-2 1.5-4 1.5-6.5a3 3 0 0 1 6 0c0 1.5-.2 3-.6 4.4M12 12c0 3-.8 5.8-2.3 8M17.5 17c.3-1.6.5-3.2.5-5a6 6 0 0 0-10.5-4M5 15c.3-1 .5-2 .5-3 0-1.2.3-2.3.9-3.3',
  mic: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Zm-6.5 9a6.5 6.5 0 0 0 13 0M12 18.5V21',
  stop: 'M7 7h10v10H7z',
  attach: 'm20 11.5-7.8 7.8a5 5 0 0 1-7-7l8.1-8.1a3.3 3.3 0 0 1 4.7 4.7l-8 8a1.7 1.7 0 0 1-2.4-2.4l7.3-7.3',
  camera: 'M4 8h3l1.5-2.5h7L17 8h3v11H4V8Zm8 8.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z',
  image: 'M4 5h16v14H4V5Zm0 11 4.5-4.5 3.5 3.5 2.5-2.5L20 17M15.5 9.5a1 1 0 1 0 0-.01',
  file: 'M14 3H6v18h12V7l-4-4Zm0 0v4h4',
  send: 'M4 12 20 4l-4.5 16-3.5-6.5L4 12Zm8 1.5L20 4',
  play: 'M8 5v14l11-7L8 5Z',
  pause: 'M8 5h3v14H8zM13 5h3v14h-3z',
  speaker: 'M5 9.5h3.5L13 5.5v13l-4.5-4H5v-5Zm11 .5a3 3 0 0 1 0 4m2.5-6.5a6.5 6.5 0 0 1 0 9',
  check: 'm5 12.5 4.5 4.5L19 7.5',
  x: 'M6 6l12 12M18 6 6 18',
  back: 'M15 5 8 12l7 7',
  forward: 'm9 5 7 7-7 7',
  down: 'm6 9 6 6 6-6',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  filter: 'M4 5h16l-6 7.5V19l-4-2v-4.5L4 5Z',
  graph: 'M6 6.5a2 2 0 1 0 0-.01M6 17.5a2 2 0 1 0 0-.01M18 12a2 2 0 1 0 0-.01M8 6.5h2.5a3 3 0 0 1 3 3V12h2.5M8 17.5h2.5a3 3 0 0 0 3-3V12',
  board: 'M4 5h4.5v14H4V5Zm5.75 0h4.5v9h-4.5V5Zm5.75 0H20v11.5h-4.5V5Z',
  list: 'M8.5 6.5H20M8.5 12H20M8.5 17.5H20M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01',
  refresh: 'M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4h-4',
  alarm: 'M12 4 2.5 20h19L12 4Zm0 6v4.5m0 3h.01',
  hand: 'M8 13V6.5a1.5 1.5 0 0 1 3 0V12m0-6.5V5a1.5 1.5 0 0 1 3 0v7m0-5.5a1.5 1.5 0 0 1 3 0V14a7 7 0 0 1-7 7h-.5a6 6 0 0 1-5-2.7L4 15a1.5 1.5 0 0 1 2.5-1.7L8 15',
  eye: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Zm9.5 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  release: 'M12 20V8m0 0-5 5m5-5 5 5M5 4h14',
  hold: 'M9 6v12m6-12v12',
  flag: 'M5 21V4m0 0h11l-2 4 2 4H5',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-13v4.5l3 2',
  quote: 'M7 8h4v4.5c0 2.5-1.5 4-4 4.5M14 8h4v4.5c0 2.5-1.5 4-4 4.5',
  host: 'M4 5h16v10H4V5Zm4 14h8m-4-4v4',
  layers: 'm12 3.5 9 4.5-9 4.5L3 8l9-4.5Zm-9 8.5 9 4.5 9-4.5M3 16l9 4.5 9-4.5',
  sparkle: 'M12 3v4m0 10v4M3 12h4m10 0h4M6 6l2.5 2.5m7 7L18 18m0-12-2.5 2.5m-7 7L6 18',
  plus: 'M12 5v14M5 12h14',
  bell: 'M12 3a6 6 0 0 0-6 6v3.5L4.5 15.5h15L18 12.5V9a6 6 0 0 0-6-6ZM9.5 18.5a2.5 2.5 0 0 0 5 0',
  share: 'M12 15V4m0 0L8 8m4-4 4 4M5 13v7h14v-7',
} as const;

export type IconName = keyof typeof PATHS;

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName;
  size?: number;
  /** A label for an icon that stands alone; omitted, the icon is decorative. */
  label?: string;
}

export function Icon({ name, size = 20, label, strokeWidth = 1.8, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
      {...props}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

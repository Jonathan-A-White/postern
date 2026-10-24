import type { ShotSize } from './shots-gallery.mjs';

export declare function changedSpecs(files: string[], exists?: (path: string) => boolean): string[];
export declare function extraSizes(): ShotSize[];
export declare function planExtraRuns(specs: string[]): { size: string; specs: string[] }[];
export declare function noExtraRunLine(): string;
export declare function changedFiles(): string[];

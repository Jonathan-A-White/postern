export interface ShotSize {
  name: string;
  width: number;
  height: number;
}
export interface ShotFile {
  name: string;
  screen: string;
  width: number;
  height: number;
  url: string;
}
export interface ShotManifest {
  version: string;
  commit: string;
  published_at: string;
  files: ShotFile[];
}
export declare const SHOT_SIZES: ShotSize[];
export declare const RAW_BASE: string;
export declare function parseShotName(name: string): { size: string; width: number; height: number; screen: string };
export declare function buildManifest(args: { names: string[]; version: string; commit: string; publishedAt: string }): ShotManifest;
export declare function buildIndexHtml(args: { names: string[]; version: string }): string;
export declare function shouldCommit(porcelainStatus: string): boolean;
export declare function stabiliseManifest(manifest: ShotManifest, previousText: string | null | undefined): ShotManifest;

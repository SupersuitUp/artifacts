export type DoorPalette = { ground: string; ink: string; accent: string };
export type DoorTheme = {
  name: string;
  kicker: string;
  scheme: 'dark' | 'light' | 'system';
  dark: DoorPalette;
  light: DoorPalette | null;
  display: string;
  /** The tenant's display face is served at /frapp/font. */
  font: boolean;
  mark: { src: string; width: number; height: number } | null;
  backdrop: string | null;
};
export function doorTarget(raw: unknown): string | null;
export function doorFragment(hash: unknown): string | null;
export function lnaGated(): Promise<boolean>;
export const DOOR_SCRIPT: string;
export const DOOR_KINDS: Record<string, { title: string; line: string }>;
export const TITLE_MAX: number;
export function doorTitle(t: unknown): string | null;
export function doorCard(k: unknown, t?: unknown): { kind: string | null; kindTitle: string; line: string; title: string | null; heading: string };
export function doorHtml(opts?: { origin?: string; kind?: string | null; title?: string | null; theme?: Partial<DoorTheme> }): string;
/** The frapp door version this deploy serves, reported on /api/health (supersuit-dev#1182). */
export const DOOR_VERSION: number;

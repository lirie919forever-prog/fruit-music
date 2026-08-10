import type { AppSettings } from '@/lib/appSettings';

export interface DesktopAudioSelection {
  id: string;
  name: string;
  size: number;
  lastModified: number;
  /** Opaque Electron protocol URL; the renderer never receives a file path. */
  url: string;
}

export interface DesktopBackgroundSelection {
  url: string;
  name: string;
  size: number;
}

export interface MareaDesktopBridge {
  readonly version: 1;
  selectAudioFiles: () => Promise<DesktopAudioSelection[]>;
  listAudioFiles: () => Promise<DesktopAudioSelection[]>;
  readAudioHeader: (id: string) => Promise<ArrayBuffer>;
  removeAudioFile: (id: string) => Promise<boolean>;
  clearAudioFiles: () => Promise<boolean>;
  loadSettings: () => Promise<AppSettings | null>;
  saveSettings: (settings: AppSettings) => Promise<boolean>;
  importBackgroundImage: () => Promise<DesktopBackgroundSelection | null>;
  removeBackgroundImage: (url: string) => Promise<boolean>;
  openExternal: (url: string) => Promise<boolean>;
}

declare global {
  interface Window {
    mareaDesktop?: MareaDesktopBridge;
  }
}

export {};

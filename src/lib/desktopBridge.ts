import type { MareaDesktopBridge } from '@/types/desktop';

/** Returns the optional preload API without ever reaching for Node in React. */
export function getDesktopBridge(): MareaDesktopBridge | null {
  return typeof window !== 'undefined' ? (window.mareaDesktop ?? null) : null;
}

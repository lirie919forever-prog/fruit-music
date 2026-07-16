import type { ViewType } from '@/types/music';

export type ThemeMode = 'dark' | 'light';

export interface ThemeColors {
  primary: string;
  secondary: string;
  accent: string;
  surface: string;
  text: string;
  textSecondary: string;
}

export const defaultTheme: Record<ThemeMode, ThemeColors> = {
  dark: {
    primary: '#ffffff',
    secondary: '#a1a1a6',
    accent: '#ff2d55',
    surface: 'rgba(255, 255, 255, 0.08)',
    text: '#ffffff',
    textSecondary: 'rgba(255, 255, 255, 0.6)',
  },
  light: {
    primary: '#1d1d1f',
    secondary: '#86868b',
    accent: '#ff2d55',
    surface: 'rgba(0, 0, 0, 0.05)',
    text: '#1d1d1f',
    textSecondary: 'rgba(0, 0, 0, 0.5)',
  },
};

export function hexToRgb(hex: string): [number, number, number] {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? [parseInt(result[1], 16), parseInt(result[2], 16), parseInt(result[3], 16)]
    : [255, 255, 255];
}

export function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((x) => Math.round(x).toString(16).padStart(2, '0')).join('')}`;
}

export function getDominantColorFromImageUrl(imageUrl: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.src = imageUrl;
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      const ctx = canvas.getContext('2d');
      if (!ctx) return resolve('#1d1d1f');
      ctx.drawImage(img, 0, 0, 1, 1);
      const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
      resolve(rgbToHex(r, g, b));
    };
    img.onerror = () => resolve('#1d1d1f');
  });
}

const viewTitles: Record<ViewType, string> = {
  albums: 'Albums',
  artists: 'Artists',
  search: 'Search',
  playlist: 'Playlist',
  'now-playing': 'Now Playing',
  pop: 'Pop',
  jp: 'J-Pop',
  trending: 'Trending',
  remixes: 'Remixes',
  jazz: 'Jazz',
  classical: 'Classical',
};

export function getViewTitle(view: ViewType): string {
  return viewTitles[view];
}

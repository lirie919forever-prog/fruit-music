import type { Metadata, Viewport } from 'next';
import { Fraunces, Geist } from 'next/font/google';
import './globals.css';

// A characterful optical serif for display headings and a clean grotesque for
// body/UI — the two-family pairing is what keeps Marea from reading like
// generic system-font UI. Both are self-hosted by next/font; the browser never
// talks to Google, so there is no privacy or font-flash cost.
const fraunces = Fraunces({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-display',
  axes: ['opsz', 'SOFT'],
});
const geist = Geist({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-body',
});

export const metadata: Metadata = {
  title: 'Marea',
  description: 'A premium music streaming experience',
  icons: { icon: '/favicon.svg' },
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'Marea' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`h-full ${geist.variable} ${fraunces.variable}`}>
      <body
        className="h-full overflow-hidden antialiased"
        style={{ fontFamily: 'var(--font-body, var(--font-ui))', color: 'var(--salt-white)' }}
      >
        {children}
      </body>
    </html>
  );
}

import type { Metadata, Viewport } from 'next';
import './globals.css';

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
    <html lang="en" className="h-full">
      <body className="h-full overflow-hidden antialiased" style={{ fontFamily: 'var(--font-ui)', color: 'var(--salt-white)' }}>
        {children}
      </body>
    </html>
  );
}

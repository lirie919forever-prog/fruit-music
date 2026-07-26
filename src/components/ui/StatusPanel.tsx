'use client';

import type { ReactNode } from 'react';

/**
 * The single presentation for "there is nothing here, and here is why".
 *
 * Every view had grown its own version of this panel with its own radius,
 * translucency and type scale, so the same provider outage looked like a
 * different class of problem depending on which tab you were standing on.
 * `tone` tints the eyebrow only — a failure should be legible, not alarming.
 */
export function StatusPanel({
  eyebrow,
  title,
  body,
  note,
  actions,
  tone = 'neutral',
  align = 'start',
}: {
  eyebrow?: string;
  title: string;
  body?: string;
  note?: string;
  actions?: ReactNode;
  tone?: 'neutral' | 'error';
  align?: 'start' | 'center';
}) {
  const centered = align === 'center';
  return (
    <div
      role="status"
      className={`rounded-xl border border-[var(--glass-border)] bg-white px-6 py-10 ${centered ? 'text-center' : ''}`}
    >
      <div className={centered ? 'mx-auto max-w-lg' : 'max-w-xl'}>
        {eyebrow && (
          <p
            className={`text-[11px] font-semibold uppercase tracking-[0.06em] ${tone === 'error' ? 'text-[var(--danger)]' : 'text-[var(--salt-primary)]'}`}
          >
            {eyebrow}
          </p>
        )}
        <h2 className={`text-[17px] font-bold text-[var(--salt-white)] ${eyebrow ? 'mt-1.5' : ''}`}>{title}</h2>
        {body && <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--salt-mist)]">{body}</p>}
        {note && <p className="mt-2 text-xs text-[var(--salt-mist)]">{note}</p>}
        {actions && (
          <div className={`mt-4 flex flex-wrap items-center gap-2 ${centered ? 'justify-center' : ''}`}>{actions}</div>
        )}
      </div>
    </div>
  );
}

export function StatusButton({
  onClick,
  children,
  variant = 'primary',
}: {
  onClick: () => void;
  children: ReactNode;
  variant?: 'primary' | 'secondary';
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex h-9 items-center gap-1.5 rounded-full px-4 text-[13px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--salt-primary)] ${
        variant === 'primary'
          ? 'bg-[var(--salt-primary)] text-white hover:bg-[var(--salt-bright)]'
          : 'border border-[var(--glass-border)] text-[var(--salt-primary)] hover:bg-[var(--glass-bg-hover)]'
      }`}
    >
      {children}
    </button>
  );
}

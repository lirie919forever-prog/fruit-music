'use client';

import type { ReactNode, HTMLAttributes } from 'react';

interface GlassPanelProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  intensity?: 'light' | 'medium' | 'heavy';
  hover?: boolean;
  glowing?: boolean;
  dominantColor?: string;
}

export function GlassPanel({
  children,
  intensity = 'medium',
  hover = false,
  glowing = false,
  dominantColor,
  className = '',
  style,
  ...props
}: GlassPanelProps) {
  const glowColor = dominantColor || 'var(--salt-primary)';
  const blurMap = {
    light: '12px',
    medium: '18px',
    heavy: '28px',
  } as const;

  return (
    <div
      className={`${hover ? 'transition-[border-color,box-shadow,background] duration-200 hover:border-[var(--glass-border-active)] hover:bg-[rgba(255,255,255,0.06)]' : ''} ${className}`.trim()}
      style={{
        background: 'rgba(255,255,255,0.04)',
        backdropFilter: `blur(${blurMap[intensity]}) saturate(var(--glass-saturate)) brightness(1.05)`,
        WebkitBackdropFilter: `blur(${blurMap[intensity]}) saturate(var(--glass-saturate)) brightness(1.05)`,
        border: '1px solid var(--glass-border)',
        borderRadius: '18px',
        boxShadow: glowing
          ? `inset 0 1px 0 rgba(255,255,255,0.08), 0 12px 36px rgba(2,8,16,0.38), 0 0 24px ${glowColor}33`
          : 'inset 0 1px 0 rgba(255,255,255,0.08), 0 12px 36px rgba(2,8,16,0.38)',
        ...style,
      }}
      {...props}
    >
      {children}
    </div>
  );
}

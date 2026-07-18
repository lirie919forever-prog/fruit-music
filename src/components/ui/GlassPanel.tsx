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
      className={`${hover ? 'transition-[box-shadow,transform] duration-200 hover:-translate-y-px hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_18px_44px_rgba(48,114,151,0.16)]' : ''} ${className}`.trim()}
      style={{
        background: 'var(--glass-bg)',
        backdropFilter: `blur(${blurMap[intensity]}) saturate(var(--glass-saturate))`,
        WebkitBackdropFilter: `blur(${blurMap[intensity]}) saturate(var(--glass-saturate))`,
        border: '1px solid var(--glass-border)',
        borderRadius: '22px',
        boxShadow: glowing
          ? `inset 0 1px 0 rgba(255,255,255,0.92), 0 14px 38px rgba(48,114,151,0.14), 0 0 26px ${glowColor}22`
          : 'inset 0 1px 0 rgba(255,255,255,0.92), 0 14px 38px rgba(48,114,151,0.12)',
        ...style,
      }}
      {...props}
    >
      {children}
    </div>
  );
}

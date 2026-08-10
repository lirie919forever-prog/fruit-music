'use client';

import type { AudioAccessMode } from './newViewModel';

const AUDIO_ACCESS_OPTIONS: Array<{ mode: AudioAccessMode; label: string }> = [
  { mode: 'full', label: 'Full tracks' },
  { mode: 'all', label: 'All audio' },
  { mode: 'preview', label: 'Previews' },
];

export function AudioAccessControl({
  mode,
  onChange,
  label,
}: {
  mode: AudioAccessMode;
  onChange: (mode: AudioAccessMode) => void;
  label: string;
}) {
  return (
    <div
      className="marea-glass-control grid w-full grid-cols-3 gap-1 rounded-lg p-1 sm:w-auto sm:min-w-[300px]"
      role="radiogroup"
      aria-label={label}
    >
      {AUDIO_ACCESS_OPTIONS.map((option) => {
        const selected = option.mode === mode;
        return (
          <button
            key={option.mode}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.mode)}
            className={`h-10 min-w-0 rounded-md px-2 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--salt-primary)] lg:h-8 ${selected ? 'bg-white/80 text-[var(--salt-white)] shadow-sm' : 'text-[var(--salt-mist)] hover:text-[var(--salt-white)]'}`}
          >
            <span className="block truncate">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

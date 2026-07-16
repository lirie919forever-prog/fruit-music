'use client';

import { usePlayerStore } from '@/store/playerStore';
import { HiSpeakerWave, HiSpeakerXMark } from 'react-icons/hi2';

export function VolumeSlider() {
  const volume = usePlayerStore((s) => s.volume);
  const setVolume = usePlayerStore((s) => s.setVolume);
  const toggleMute = usePlayerStore((s) => s.toggleMute);
  const volumePct = Math.round(volume * 100);

  return (
    <div className="group flex items-center gap-2">
      <button
        onClick={toggleMute}
        aria-label={volume === 0 ? 'Unmute' : 'Mute'}
        aria-pressed={volume === 0}
        className="flex h-6 w-6 items-center justify-center rounded-full text-[var(--salt-mist)] transition-colors duration-150 hover:text-[var(--salt-white)]"
      >
        {volume === 0 ? <HiSpeakerXMark size={16} /> : <HiSpeakerWave size={16} />}
      </button>

      <div className="relative h-[2px] w-20 rounded-full bg-[var(--salt-ghost)] transition-all duration-200 group-hover:h-[6px] group-focus-within:h-[6px]">
        <div
          className="pointer-events-none absolute inset-y-0 left-0 rounded-full bg-[linear-gradient(90deg,var(--salt-bright),var(--salt-primary))]"
          style={{ width: `${volumePct}%` }}
        />
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={volumePct}
          aria-label="Volume"
          aria-valuetext={`${volumePct}%`}
          onChange={(event) => setVolume(Number(event.target.value) / 100)}
          className="player-range absolute inset-0"
        />
      </div>
    </div>
  );
}

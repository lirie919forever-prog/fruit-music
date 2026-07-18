'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { usePlayerStore } from '@/store/playerStore';
import { api } from '@/lib/api';
import { providerErrorMessage } from '@/lib/providers/errors';
import { CoverArt } from '@/components/ui/CoverArt';
import type { Artist } from '@/types/music';

export function ArtistGrid() {
  const { data: artistState, isLoading, isError, error, refetch } = useQuery({ queryKey: ['artists'], queryFn: ({ signal }) => api.getArtists(signal), staleTime: 60_000 });
  const artists = artistState?.results;
  const failedProviders = artistState?.failedProviders ?? [];
  const allProvidersFailed = Boolean(artistState && failedProviders.length === artistState.providerCount);
  if (isLoading) return <ArtistSkeleton />;
  if (isError) return <Failure message={providerErrorMessage(error)} retry={() => void refetch()} />;
  if (allProvidersFailed) return <Failure message="Artist providers are unavailable. Please try again." retry={() => void refetch()} />;
  if (!artists?.length) return <p className="px-4 py-10 text-[var(--salt-mist)] sm:px-6">No provider-backed artists are available.</p>;

  return (
    <section className="pb-[120px]">
      <div className="px-4 pb-4 pt-5 sm:px-6">
        <h2 className="text-[28px] font-semibold italic text-[var(--salt-white)]" style={{ fontFamily: 'var(--font-display)' }}>Artists</h2>
        {failedProviders.length > 0 && <p className="mt-1 text-xs text-[var(--salt-mist)]">{failedProviders.join(', ')} {failedProviders.length === 1 ? 'is' : 'are'} unavailable. Showing available artists.</p>}
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-6 px-4 min-[420px]:grid-cols-3 sm:px-6 md:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
        {artists.map((artist) => <ArtistCard key={artist.id} artist={artist} />)}
      </div>
    </section>
  );
}

function ArtistCard({ artist }: { artist: Artist }) {
  const playAlbum = usePlayerStore((state) => state.playAlbum);
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');
  const requestRef = useRef<AbortController | null>(null);

  useEffect(() => () => requestRef.current?.abort(), []);

  const loadAndPlay = async () => {
    if (state === 'loading') return;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setState('loading');
    try {
      const songs = await api.getArtistSongs(artist.id, controller.signal);
      if (!songs.length) throw new Error('No verified tracks are available for this artist.');
      playAlbum(songs, 0);
      setState('idle');
    } catch {
      if (!controller.signal.aborted) setState('error');
    } finally {
      if (requestRef.current === controller) requestRef.current = null;
    }
  };

  return <article className="min-w-0 text-center"><button type="button" onClick={() => void loadAndPlay()} disabled={state === 'loading'} aria-label={`Play tracks by ${artist.name}`} className="group block w-full rounded-[24px] p-2 transition-[background,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:bg-[var(--glass-bg-hover)] hover:shadow-[0_12px_26px_rgba(47,119,157,0.1)] disabled:cursor-wait disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--salt-primary)]"><span className="relative block aspect-square overflow-hidden rounded-full border-4 border-white shadow-[0_8px_22px_rgba(47,119,157,0.16)]"><CoverArt src={artist.coverArt} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105 group-focus-visible:scale-105" /><span className="absolute inset-0 flex items-center justify-center bg-[color-mix(in_srgb,var(--salt-primary)_24%,transparent)] text-lg text-white opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-visible:opacity-100">{state === 'loading' ? <span aria-hidden className="h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent" /> : '▶'}</span></span><span className="mt-3 block truncate text-sm font-semibold text-[var(--salt-white)]">{artist.name}</span></button>{state === 'error' && <p className="mt-1 text-xs text-[var(--danger)]">Could not load tracks. <button type="button" onClick={() => void loadAndPlay()} className="rounded underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--salt-primary)]">Try again</button></p>}</article>;
}

function Failure({ message, retry }: { message: string; retry: () => void }) { return <div className="flex flex-col items-start gap-3 px-4 py-10 text-[var(--salt-mist)] sm:px-6"><p>{message}</p><button type="button" onClick={retry} className="rounded-full border border-[var(--glass-border-active)] px-4 py-2 text-sm text-[var(--salt-white)]">Try again</button></div>; }
function ArtistSkeleton() { return <div className="grid grid-cols-2 gap-x-4 gap-y-6 px-4 pt-5 min-[420px]:grid-cols-3 sm:px-6 md:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">{Array.from({ length: 12 }).map((_, i) => <div key={i} className="space-y-3 p-2"><div className="aspect-square animate-pulse rounded-full bg-[var(--salt-ghost)]" /><div className="mx-auto h-3 w-2/3 animate-pulse rounded bg-[var(--salt-ghost)]" /></div>)}</div>; }

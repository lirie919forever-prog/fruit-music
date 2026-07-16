'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { usePlayerStore } from '@/store/playerStore';
import { api } from '@/lib/api';
import { providerErrorMessage } from '@/lib/providers/errors';
import type { Artist } from '@/types/music';

export function ArtistGrid() {
  const { data: artists, isLoading, isError, error, refetch } = useQuery({ queryKey: ['artists'], queryFn: () => api.getArtists(), staleTime: 60_000 });
  if (isLoading) return <ArtistSkeleton />;
  if (isError) return <Failure message={providerErrorMessage(error)} retry={() => void refetch()} />;
  if (!artists?.length) return <p className="px-4 py-10 text-[var(--salt-mist)] sm:px-6">No provider-backed artists are available.</p>;

  return <section className="pb-[120px]"><h2 className="px-4 pb-4 pt-5 text-[28px] font-semibold italic text-[var(--salt-white)] sm:px-6" style={{ fontFamily: 'var(--font-display)' }}>Artists</h2><div className="grid grid-cols-3 gap-3 px-4 sm:grid-cols-[repeat(auto-fill,minmax(130px,1fr))] sm:gap-6 sm:px-6">{artists.map((artist) => <ArtistCard key={artist.id} artist={artist} />)}</div></section>;
}

function ArtistCard({ artist }: { artist: Artist }) {
  const playAlbum = usePlayerStore((state) => state.playAlbum);
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');
  const loadAndPlay = async () => {
    if (state === 'loading') return;
    setState('loading');
    try {
      const songs = await api.getArtistSongs(artist.id);
      if (!songs.length) throw new Error('No verified tracks are available for this artist.');
      playAlbum(songs, 0);
      setState('idle');
    } catch { setState('error'); }
  };

  return <article className="min-w-0 text-center"><button type="button" onClick={() => void loadAndPlay()} disabled={state === 'loading'} aria-label={`Play tracks by ${artist.name}`} className="group w-full disabled:cursor-wait disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--salt-primary)]"><div className="relative aspect-square overflow-hidden rounded-full"><img src={artist.coverArt || '/placeholder-album.svg'} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover transition-transform group-hover:scale-105" /><span className="absolute inset-0 flex items-center justify-center bg-[rgba(2,8,16,0.4)] text-lg text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">{state === 'loading' ? '…' : '▶'}</span></div><span className="mt-2 block truncate text-sm font-medium text-[var(--salt-white)]">{artist.name}</span></button>{state === 'error' && <p className="mt-1 text-xs text-[var(--danger)]">Could not load tracks. <button type="button" onClick={() => void loadAndPlay()} className="underline">Try again</button></p>}</article>;
}

function Failure({ message, retry }: { message: string; retry: () => void }) { return <div className="flex flex-col items-start gap-3 px-4 py-10 text-[var(--salt-mist)] sm:px-6"><p>{message}</p><button type="button" onClick={retry} className="rounded-full border border-[var(--glass-border-active)] px-4 py-2 text-sm text-[var(--salt-white)]">Try again</button></div>; }
function ArtistSkeleton() { return <div className="grid grid-cols-3 gap-3 px-4 pt-5 sm:grid-cols-[repeat(auto-fill,minmax(130px,1fr))] sm:gap-6 sm:px-6">{Array.from({ length: 12 }).map((_, i) => <div key={i} className="aspect-square animate-pulse rounded-full bg-[var(--salt-ghost)]" />)}</div>; }

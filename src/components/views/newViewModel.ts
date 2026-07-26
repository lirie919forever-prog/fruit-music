import type { Song } from '@/types/music';

export function interleaveSongGroups(groups: Array<Song[] | undefined>, limit = Number.POSITIVE_INFINITY): Song[] {
  const populatedGroups = groups.filter((group): group is Song[] => Boolean(group?.length));
  const maxLength = Math.max(0, ...populatedGroups.map((group) => group.length));
  const seen = new Set<string>();
  const songs: Song[] = [];

  for (let index = 0; index < maxLength && songs.length < limit; index++) {
    for (const group of populatedGroups) {
      const song = group[index];
      if (!song || seen.has(song.id)) continue;
      seen.add(song.id);
      songs.push(song);
      if (songs.length >= limit) break;
    }
  }

  return songs;
}

export function playableSongs(songs: Song[]): Song[] {
  return songs.filter((song) => song.playbackUnavailable !== true);
}

export function uniqueAlbumSongs(songs: Song[], limit = Number.POSITIVE_INFINITY): Song[] {
  const seen = new Set<string>();
  return songs.filter((song) => {
    const albumName = song.album.trim().toLowerCase();
    const genericAlbum =
      albumName === 'unknown' || albumName === 'unknown album' || albumName === 'untitled' || albumName === 'n/a';
    if (!song.albumId || genericAlbum || seen.has(song.albumId) || seen.size >= limit) return false;
    seen.add(song.albumId);
    return true;
  });
}

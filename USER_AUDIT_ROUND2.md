# Marea - User-Perspective Critique (Round 2)

This critique is from the viewpoint of a first-time visitor opening the live
production site at https://fruit-music-nine.vercel.app. Each finding is backed
by a concrete browsing session via Playwright and/or direct API verification.

## Findings

### C1 (CRITICAL): Charts offer 50 songs you can only hear for 30 seconds

**What the user sees:** Opens UK Charts, sees 50 real entries (Ariana Grande,
Sam Fender, Taylor Swift, Bruno Mars) with a note promising 'full recording
when a match confirms one'. Every entry shows a PREVIEW badge and 0:30 duration.
Clicking play gives a 30-second clip. None were upgraded to full tracks.

**Evidence:** `GET /api/music/charts?chart=uk` returns 50 results, all
provider='Apple Preview', duration=30. Zero upgraded to MATCH/FULL.
resolveChartFullTracks searches Kuwo (CJK-focused, no Western mainstream),
Audius, Jamendo (CC platforms, no major-label copyright music). None have
these tracks, so 0/50 match.

**Impact:** This is the user's #1 recurring complaint. The chart page is
essentially a teaser gallery, not a listening experience. The honest prose
doesn't fix the underlying problem: mainstream charts are unplayable.

**Root cause:** No registered full-track source carries Western mainstream
music outside 30-second Apple/Deezer previews. This is a licensing constraint.
The code correctly tries to resolve them; the sources simply don't have them.

### C2 (HIGH): Homepage hero features a raw .wav field recording, not music

**What the user sees:** The 'Marea pick' and 'Also in the spotlight' sections
on the homepage feature 'Viva la Virgen de Capilludos Castrillo-Tejeriego.wav'
by 'Elenafra' from Wikimedia Commons. This is a filed field recording with a
filename as its title, not a curated track.

**Impact:** Terrible first impression. A music app's homepage hero should
feature actual music with proper titles, artist names, and cover art. A raw
WAV filename novel longer than the display area signals 'this app has no real
content'.

**Root cause:** Spotlight/hero selection is metadata-driven with no content
quality filter. Wikimedia Commons returns field recordings alongside genuine
music, and the selection logic surfaces one without distinguishing them.

### C3 (HIGH): Searching for a mainstream artist hides the real full tracks

**What the user sees:** Searching 'Ariana Grande' with the default 'Full
tracks' filter returns 84 results from Audius and Jamendo - covers, remixes,
and tributes. The actual full tracks exist on Kuwo (320kbps MP3, confirmed
playable) but are filtered out because Kuwo is classified as 'match' not
'full', and the Full tracks filter excludes resolver sources entirely.

**Evidence:** `isDirectFullTrack()` in newViewModel.ts explicitly excludes
resolver sources: `isFullTrack(song) && !isResolverSource(song.provider)`.
Kuwo tracks ARE full-length playable tracks (probe confirmed available=true),
but the filter removes them from the default view.

**Impact:** The user never sees the real, playable mainstream tracks they
searched for. The app looks like it only has amateur covers.

### C4 (MEDIUM): Two search boxes on the search page

**What the user sees:** The header bar has a 'Search music' input and the
search page body has another 'Search music' input, both active. The user does
not know which to type in; results appear from the body one.

### C5 (MEDIUM): Two of seven full-track CC sources are down

**What the user sees:** Searching 'Ariana Grande' shows 'ccMixter: Unavailable'
and 'Archive: Unavailable' in the results status. These are supposed to be
primary full-track sources but are failing.

### C6 (LOW): Chart track durations show 0:30 not the real song length

**What the user sees:** Every chart track shows '0:30' as its duration
instead of the recordingDuration (e.g. 3:18). This makes the entries look
like samples, discouraging engagement.

**Root cause:** The chart endpoint maps duration from the 30-second preview
duration, not recordingDuration. The full duration is stored in
recordingDuration but not displayed in the track row.

### C7 (LOW): '17 sources' but 4 are metadata-only dead ends

**What the user sees:** The source dropdown says '17 sources' but 4 of those
(MusicBrainz, Open Opus, Tunetank, and the metadata-only ones) never return
playable audio. Selecting them gives 'No match' with no explanation that
they are metadata-only by design.

## Summary table

| ID | Severity | Finding | Code-fixable? |
|----|----------|---------|---------------|
| C1 | CRITICAL | Charts are all 30s previews, 0/50 upgraded | Licensed-source limitation |
| C2 | HIGH | Homepage hero features a .wav field recording | Yes - content curation |
| C3 | HIGH | Search hides real full tracks behind filter logic | Yes - filter logic |
| C4 | MEDIUM | Two search boxes on search page | Yes - remove duplicate |
| C5 | MEDIUM | ccMixter + Archive sources down | Yes - robustness |
| C6 | LOW | Chart tracks show 0:30 not recording duration | Yes - display fix |
| C7 | LOW | Metadata-only sources shown without explanation | Yes - labeling |

## Recommended fixes (priority order)

1. C3: Include resolver sources (Kuwo, LX Music) in the 'Full tracks' filter
   since their resolved tracks ARE full-length playable audio. This is the
   single most impactful fix - it makes mainstream search actually show
   mainstream full tracks.
2. C6: Display recordingDuration in chart track rows, not the preview
   duration.
3. C2: Filter Wikimedia Commons items whose title contains '.wav', '.ogg',
   '.mp3' or has no proper metadata from homepage hero selection.
4. C4: Remove the duplicate search box on the search page.


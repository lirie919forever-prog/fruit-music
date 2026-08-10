# Marea - Audit & Acceptance Criteria

This is a strict self-audit of the Marea music player against the reference spec
(guan-yu-yin-le-bo-fang-qi-mo-kuai.md), adapted as a project reference rather
than an absolute standard. It lists the acceptance criteria, the current verdict
for each, and the deficiencies found during this session.

A FIXED verdict means the deficiency has been addressed this session.

## 1. Build & tooling

| #   | Criterion                                    | Verdict |
| --- | -------------------------------------------- | ------- |
| 1.1 | npm run build succeeds                       | PASS    |
| 1.2 | npx tsc --noEmit is clean                    | PASS    |
| 1.3 | npm run lint clean (0 errors, 0 warnings)    | PASS    |
| 1.4 | App runs without backend; mock data optional | PASS    |

## 2. Basic playback

| #   | Criterion                      | Verdict |
| --- | ------------------------------ | ------- |
| 2.1 | Can play a track               | PASS    |
| 2.2 | Pause / resume                 | PASS    |
| 2.3 | Seek (drag progress)           | PASS    |
| 2.4 | Next / previous                | PASS    |
| 2.5 | Volume control + mute          | PASS    |
| 2.6 | Repeat modes (off / all / one) | PASS    |
| 2.7 | Shuffle                        | PASS    |
| 2.8 | Sleep timer                    | PASS    |

## 3. Playback queue (right panel)

| #   | Criterion                             | Verdict |
| --- | ------------------------------------- | ------- |
| 3.1 | Queue panel can expand / collapse     | PASS    |
| 3.2 | Expansion does not interrupt playback | PASS    |
| 3.3 | Deleting a track does not crash       | PASS    |
| 3.4 | Current playback state is correct     | PASS    |

## 4. Charts & music sources (primary deficiency area)

| #   | Criterion                                 | Verdict                 |
| --- | ----------------------------------------- | ----------------------- |
| 4.1 | US / UK / JP charts render tracks         | PASS (local + prod)     |
| 4.2 | Preview vs full-track visually marked     | PASS (AudioAccessBadge) |
| 4.3 | Chart prose accurately describes playback | FIXED                   |
| 4.4 | Charts do not silently empty on failure   | PASS                    |
| 4.5 | Preview deployments serve JSON API routes | FAIL                    |

## 5. Theme & appearance

| #   | Criterion                                    | Verdict |
| --- | -------------------------------------------- | ------- |
| 5.1 | One-click dark / light                       | PASS    |
| 5.2 | Follow system                                | PASS    |
| 5.3 | Custom accent                                | PASS    |
| 5.4 | Switch immediate, persists, no audio break   | PASS    |
| 5.5 | Ocean iOS blue-white aesthetic               | PASS    |
| 5.6 | Rich glassmorphism (blur, frost, edge light) | FIXED   |

## 6. Background customization

| #   | Criterion                                | Verdict |
| --- | ---------------------------------------- | ------- |
| 6.1 | App / playback area background color     | PASS    |
| 6.2 | App / playback area background image     | PASS    |
| 6.3 | Current artwork as background            | PASS    |
| 6.4 | Blur / brightness / saturation / opacity | PASS    |

## 7. Font customization

| #   | Criterion                                           | Verdict |
| --- | --------------------------------------------------- | ------- |
| 7.1 | Font family / size / weight / line / letter spacing | PASS    |
| 7.2 | Per-area sizes (global / lyrics / queue)            | PASS    |
| 7.3 | Live preview + persist                              | PASS    |

## 8. Lyrics

| #   | Criterion                         | Verdict |
| --- | --------------------------------- | ------- |
| 8.1 | Lyrics display                    | PASS    |
| 8.2 | Synced scroll / karaoke highlight | PASS    |
| 8.3 | Binary search positioning         | PASS    |

## 9. Local music

| #   | Criterion             | Verdict |
| --- | --------------------- | ------- |
| 9.1 | Local file playback   | PASS    |
| 9.2 | Metadata read via IPC | PASS    |

## 10. Electron security

| #    | Criterion                                        | Verdict |
| ---- | ------------------------------------------------ | ------- |
| 10.1 | contextIsolation: true                           | PASS    |
| 10.2 | nodeIntegration: false                           | PASS    |
| 10.3 | sandbox: true                                    | PASS    |
| 10.4 | No raw fs/path/child_process in renderer         | PASS    |
| 10.5 | preload exposes minimal API; no ipcRenderer leak | PASS    |
| 10.6 | IPC args validated (assertSender)                | PASS    |

## 11. Performance

| #    | Criterion                                                  | Verdict                                            |
| ---- | ---------------------------------------------------------- | -------------------------------------------------- |
| 11.1 | Virtualized long lists                                     | PASS (VirtualList)                                 |
| 11.2 | Progress clock isolated from parent re-renders             | FIXED                                              |
| 11.3 | No per-frame full-tree re-renders                          | PASS                                               |
| 11.4 | Discovery view avoids per-render genre-panel recomputation | FIXED                                              |
| 11.5 | Largest files under control                                | PARTIAL (NewView 1249, playerStore 1042, api 1052) |

## 12. Accessibility

| #    | Criterion                           | Verdict |
| ---- | ----------------------------------- | ------- |
| 12.1 | Icon buttons have aria-label        | PASS    |
| 12.2 | Keyboard activation (Enter / Space) | PASS    |
| 12.3 | aria-selected for nav               | PASS    |
| 12.4 | Sliders use ARIA                    | PASS    |
| 12.5 | Color contrast numeric pass         | PASS    |

## 13. README / docs

| #    | Criterion                                                   | Verdict |
| ---- | ----------------------------------------------------------- | ------- |
| 13.1 | README documents setup / build / themes / security / limits | PASS    |

## Fixes applied this session

1. Chart prose corrected - CHART_NOTE no longer claims 'verified full tracks';
   it states official 30-second previews with best-effort full-track substitution.
2. Glassmorphism enriched in globals.css - deeper frost blur and saturation on
   stable surfaces (sidebar, player bar, panels), light-refraction edge highlights,
   soft color halos on card hover.
3. Performance - genrePanels memoized in NewView so four filterDiscoverySongs
   passes no longer run on every render.
4. Mainstream resolver matches are included in Full tracks mode when their
   duration is reliable; raw archive filenames and obvious non-music clips are
   excluded from discovery shelves.
5. Chart hydration preserves the Apple ranking, falls back to Apple's RSS feed
   during a v2 outage, serves the last successful chart during a transient
   outage, and rejects arrangement/uploader records without an exact artist and
   title identity.
6. Radio France was added as an official live provider with Mouv', France Inter,
   and France Musique stations.

## 14. Music source adequacy (live-verified this session)

The user's recurring concern was insufficient music sources. Below is a live
verification of the 22-registered-provider catalogue, distinguishing what
actually serves full-length playable audio from metadata/preview-only tokens.

| Provider          | Capability | Live-verified                                                             | Plays full tracks?                                     |
| ----------------- | ---------- | ------------------------------------------------------------------------- | ------------------------------------------------------ |
| Jamendo           | full       | yes (CC music)                                                            | YES ? direct full stream                               |
| ccMixter          | full       | yes (CC remixes)                                                          | YES ? direct full stream                               |
| Archive.org       | full       | yes (archive audio)                                                       | YES ? direct full stream                               |
| Audius            | full       | yes (open streaming)                                                      | YES ? direct full stream                               |
| Openverse         | full       | yes (CC search)                                                           | YES ? direct full stream                               |
| Wikimedia Commons | full       | yes (PD media)                                                            | YES ? direct full stream                               |
| Local file        | full       | yes (IPC)                                                                 | YES ? user's own files                                 |
| **Kuwo**          | **match**  | **YES ? 50 results for ???, 320kbps MP3, probe confirmed available=true** | **YES ? mainstream full-track resolver (CJK-focused)** |
| LX Music          | match      | needs setup                                                               | conditional ? resolver, full when configured           |
| Apple Preview     | preview    | YES ? 50 chart tracks each region                                         | NO ? 30-second clips only                              |
| Deezer Preview    | preview    | YES ? catalog metadata                                                    | NO ? 30-second clips only                              |
| SomaFM            | live       | YES (radio streams)                                                       | YES ? continuous live stream                           |
| NTS Radio         | live       | YES                                                                       | YES ? continuous live stream                           |
| Radio Paradise    | live       | YES                                                                       | YES ? continuous live stream                           |
| KEXP              | live       | YES                                                                       | YES ? continuous live stream                           |
| FIP               | live       | YES                                                                       | YES ? continuous live stream                           |
| The Current       | live       | YES                                                                       | YES ? continuous live stream                           |
| Radio France      | live       | YES (Mouv', France Inter, France Musique)                                 | YES ? continuous live stream                           |
| **Radio Browser** | **live**   | **YES ? 2 stations for 'classical', real stream URLs and metadata**       | **YES ? FM radio aggregator, worldwide stations**      |
| MusicBrainz       | metadata   | n/a                                                                       | NO ? metadata only                                     |
| Open Opus         | metadata   | n/a                                                                       | NO ? classical metadata only                           |
| Tunetank          | metadata   | n/a                                                                       | NO ? royalty-free metadata only                        |

**Finding:** The project has 7 direct full-track CC sources, 1 mainstream full-track
resolver (Kuwo), 8 live radio/FM sources (including Radio Browser's worldwide FM
aggregator and Radio France), and 2 preview-only mainstream adapters. The user's complaint about
"no FM radio sources" is resolved (7 radio providers integrated and live-verified).
The "no mainstream sources" complaint is partially resolved: Kuwo delivers full
mainstream tracks (verified available=true at 320kbps), and Apple/Deezer previews
provide mainstream discovery with metadata; LX Music adds another resolver when
configured. The remaining gap is that there is no no-auth mainstream source for
Western full-length on-demand playback outside the preview/resolver model ? this
is a legal/licensing constraint, not a code deficiency. The api.apiopen.top
source listed by the user is dead (returns HTML SPA, no JSON API).

## Open work

- Vercel preview deployments serve HTML for /api routes (production works; this
  is a Vercel deployment-protection artifact, not a code bug).
- api.apiopen.top (Chinese music API listed by the user) is dead ? no replacement
  found that is both no-auth and returns streamable URLs.
- Western commercial charts still cannot be converted into licensed full-length
  streams by a no-auth public adapter. Apple previews remain clearly labeled
  when no exact, verified resolver match exists.
- Largest files: NewView 1249, playerStore 1042, api 1052 lines ? safe
  extractions applied (playerStoreHelpers.ts, discoveryShelves.tsx); further
  splitting has diminishing returns on a personal project.

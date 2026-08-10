# Marea - User-Perspective Critique (Round 2, Updated)

This critique is from the viewpoint of a first-time visitor opening the live
production site at https://fruit-music-nine.vercel.app. The original findings
are retained below with their current status after the follow-up implementation.

## Findings

### C1 (CRITICAL, residual): Charts can still contain 30-second previews

Apple regional charts still expose official 30-second clips when no exact,
verified full-track resolver match exists. The chart copy and PREVIEW badge now
say that plainly, and chart hydration preserves the Apple ranking instead of
substituting a similar recording.

**Current status:** The remaining limitation is source availability: no public
no-auth adapter can provide licensed full-length Western commercial recordings
for every chart row. This is the primary product gap, not a matching bug.

### C2 (HIGH, fixed): Homepage hero could feature a raw archive filename

Wikimedia Commons can return field recordings and files named with extensions
such as `.wav` or `.ogg` alongside actual music.

**Current status:** Discovery selection filters archive filenames and obvious
non-music clip titles before they reach the hero or release rails.

### C3 (HIGH, fixed): Full-track search hid resolver matches

Kuwo and LX Music entries are resolver identities whose stream still needs a
playback check. They were previously excluded from the Full tracks filter even
when their reported duration described a full recording.

**Current status:** Duration-qualified resolver results are included in Full
tracks mode and remain labeled VERIFY because playback is checked at selection
time.

### C4 (MEDIUM, fixed): Search entry points looked duplicated

The header exposes a Search music action, while the Search page owns the query
input.

**Current status:** The header control is a navigation/action button, not a
second text input. The Search page has the single active query field.

### C5 (MEDIUM, mitigated): Individual open providers can be unavailable

Public provider uptime varies, and a search can still show a source as
unavailable when its upstream endpoint is down.

**Current status:** Provider failures are isolated, surfaced in source coverage,
and no longer blank successful results from other providers. Upstream
availability remains variable and cannot be guaranteed by the client.

### C6 (LOW, fixed): Chart rows showed the preview duration

**Current status:** Chart rows use `recordingDuration` when available, while the
PREVIEW badge and chart prose continue to make the 30-second stream limit clear.

### C7 (LOW, fixed): Metadata references were mixed with playable sources

**Current status:** Metadata-only references are categorized in the source
directory, excluded from playable search options, and labeled as metadata-only
instead of pretending to be audio providers.

## Summary table

| ID  | Severity | Finding                                        | Current status             |
| --- | -------- | ---------------------------------------------- | -------------------------- |
| C1  | CRITICAL | Some mainstream chart rows remain 30s previews | Residual source limitation |
| C2  | HIGH     | Homepage hero could show archive filenames     | Fixed                      |
| C3  | HIGH     | Resolver matches hidden by Full tracks filter  | Fixed                      |
| C4  | MEDIUM   | Search entry points looked duplicated          | Fixed                      |
| C5  | MEDIUM   | Individual open providers can be down          | Mitigated                  |
| C6  | LOW      | Chart rows showed 0:30                         | Fixed                      |
| C7  | LOW      | Metadata-only sources lacked separation        | Fixed                      |

## Remaining priorities

1. Add only licensed or user-configured full-length providers for Western
   commercial charts. Do not turn an unrelated upload into a chart match.
2. Continue monitoring open-provider availability and preserve per-source
   degradation when an upstream endpoint fails.

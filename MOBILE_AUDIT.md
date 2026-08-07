# Marea - Mobile UX Audit (Round 4)

Verified against the running app at 390x844 CSS pixels with Playwright.

## Status

### M1: Mobile seek control - fixed

The compact mini-player now exposes a full-width seek slider below the mobile
transport controls. A live playback check showed the slider enabled and
updating while a Kuwo full track was playing.

### M2: Mobile lyrics and volume access - fixed

Lyrics and volume remain available in the mobile mini-player. Volume opens an
accessible popover with its own slider, and Lyrics navigates to Now Playing.

### M3: Raw archive filenames in discovery - fixed

Discovery shelves filter archive-style `.ogg`, `.wav`, `.mp3`, `.flac`, `.m4a`,
`.aac`, and `.opus` titles before they reach the spotlight and genre sections.

### M4: Settings close affordance - invalidated

The settings drawer already has a top close button on mobile. The drawer is
full-width with a bounded maximum width, so the original finding is no longer
present. Swipe-to-close remains optional polish, not a current usability bug.

### M5: Mobile navigation hit testing - fixed

The navigation drawer now renders through a body portal. This keeps its full
viewport overlay outside the header's backdrop-filter stacking context, so
navigation items receive taps instead of the page header underneath them.

### M6: Long mobile page titles - fixed

The mobile header uses a compact title size so labels such as `Japan Charts`
remain visible beside the utility controls at 390px.

## Verification notes

- No horizontal overflow: `document.documentElement.scrollWidth === 390`.
- Japanese search returned mainstream Kuwo matches, including YOASOBI.
- Selecting `怪物` reached `Verified full track via Kuwo`.
- The mobile seek, Lyrics, and Volume controls were all reachable without
  opening the desktop sidebar.
- The navigation drawer measured the full 390x844 viewport and navigated to
  Radio from a fresh tap.

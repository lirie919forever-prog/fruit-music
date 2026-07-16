# Marea Product Requirements

## Purpose

Marea is a premium music web UI focused on direct rendering, stable playback flows, and a dark ambient visual system. This document is the current source of truth for architectural constraints. Historical notes are preserved in `docs/legacy/`.

## Strict Constraints

### Zero Virtualization

All grids and lists must render directly from their full in-memory arrays. `@tanstack/virtual`, custom windowing, partial rendering, "show more", "load more", and pagination are strictly prohibited for the current library sizes.

### Data Flow

Album and artist records are lightweight summaries. Do not mutate `Album` or `Artist` objects to attach embedded song arrays. Fetch full audio queues (`Song[]`) on demand through the existing provider/API flow and React Query where data is rendered.

### UI Standards

The main scroll container must keep exactly `paddingBottom: '88px'` so content clears the fixed player. The bottom player must remain fixed at the viewport bottom, use `z-50`, and keep a `72px` height. UI styling must use the Tailwind CSS v4 setup and existing design tokens.

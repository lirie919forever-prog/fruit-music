# Marea Product Requirements

## Purpose

Marea is a premium blue-white Ocean music UI with an optional Midnight reading mode, stable playback flows, and provider-backed catalogs. This document is the current source of truth for architectural constraints. Historical notes are preserved in `docs/legacy/`.

## Strict Constraints

### Virtualized Collections

Large result lists and queues use `@tanstack/react-virtual` through the shared `VirtualList` component. Virtualization must preserve stable keys, measured row dimensions, keyboard focus, and the full in-memory data contract; it must not be replaced with ad hoc pagination or provider-specific windowing.

### Data Flow

Album and artist records are lightweight summaries. Do not mutate `Album` or `Artist` objects to attach embedded song arrays. Fetch full audio queues (`Song[]`) on demand through the existing provider/API flow and React Query where data is rendered.

### UI Standards

The main scroll container must clear the fixed player through `--player-bar-clearance`. The bottom player must remain fixed at the viewport bottom, use `z-50`, and keep a `72px` base height. UI styling must use the Tailwind CSS v4 setup and existing design tokens.

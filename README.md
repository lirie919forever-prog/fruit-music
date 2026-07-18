# Marea

Marea is a blue-white ocean Creative Commons music app built with Next.js 16, React 19, Zustand, React Query, and Howler. It browses verified music from Jamendo, ccMixter, and the Internet Archive.

## Requirements

- Node.js 20 or newer
- npm
- Optional: a free Jamendo API client ID from [Jamendo Developer](https://devportal.jamendo.com/). ccMixter and Internet Archive work without credentials.

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env.local`. To enable Jamendo, set its server-only client ID:

   ```env
   JAMENDO_CLIENT_ID=your_client_id
   ```

   Never expose this value through a `NEXT_PUBLIC_` variable. The Jamendo v3 integration does not use a client secret; do not add one to the repository or deployment unless an official endpoint is introduced that explicitly requires it.

3. Start development:

   ```bash
   npm run dev
   ```

4. Open [http://localhost:3000](http://localhost:3000).

Curated Pop, J-Pop, and Classical views use verified Jamendo tracks. Trending combines provider-backed Jamendo and ccMixter signals; federated search can include verified Archive tracks after exact media and licensing metadata are resolved. Albums are provider-backed summaries, and ccMixter/Archive remain available where their metadata satisfies the app's provenance and playback requirements. When a provider fails, healthy provider results remain available and the UI reports the degraded source honestly.

LX Music custom sources are intentionally unsupported. They are executable, undocumented provider adapters rather than a stable, rights-cleared HTTP API; running arbitrary source scripts would bypass this app's host validation and credential boundaries.

## Commands

```bash
npm run dev        # development server
npm run lint       # ESLint
npm run typecheck  # TypeScript without emitting files
npm run test       # Vitest unit and route tests
npm run check      # lint, typecheck, and tests
npm run build      # production build
npm run start      # serve the production build
```

## Architecture constraints

[PRD.md](PRD.md) is the current source of truth. In particular:

- Lists and grids render their complete in-memory arrays without virtualization or pagination.
- Albums and artists are summaries; full song queues are fetched on demand.
- The bottom player remains fixed at 72px with an 88px content clearance.

## Providers and streaming

Browser requests go through `src/app/api/music/[...path]/route.ts`, which keeps credentials server-side, validates provider input, forwards media byte ranges, and preserves upstream media statuses. Search can return partial results when one provider fails.

## Deployment

Set `JAMENDO_CLIENT_ID` separately in each Vercel environment where Jamendo should be enabled; Preview and Production do not automatically share values. Never store or log a Jamendo client secret. If any secret is pasted into chat, logs, or another shared surface, revoke and rotate it in the Jamendo developer portal.

Deploy and smoke-test a Preview before publishing Production. The local `.vercel` directory contains machine-specific linkage and should remain private.

# Marea

Marea is a blue-white ocean Creative Commons music app built with Next.js 16, React 19, Zustand, React Query, and Howler. It browses verified music from Jamendo, ccMixter, and the Internet Archive, with a separate opt-in LX Music integration.

## Requirements

- Node.js 20.19 or newer
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

   LX Music is disabled by default. To opt in, set the public feature flag and at least one server-side HTTPS endpoint:

   ```env
   NEXT_PUBLIC_LX_ENABLED=true
   LX_API_BASE=https://your-reviewed-provider.example
   # Optional: LX_RESOLVER_BASE=https://your-reviewed-resolver.example
   ```

   Enabling LX exposes its search, chart, and playback routes. LX results are governed by the selected provider's terms rather than verified Creative Commons metadata. Deployment operators are responsible for reviewing those terms, content rights, and applicable licensing requirements.

   The flag is read at build time as well as at runtime. `api.vkeys.cn` — the community search endpoint LX falls back to, and the only host that serves LX cover art — is added to the image optimizer's `remotePatterns` **only** when `NEXT_PUBLIC_LX_ENABLED=true` is set for the build. A default build permits Jamendo, ccMixter and Apple artwork and nothing else. This used to be untrue: the host sat unconditionally in the artwork allowlist, so every deployment permitted it whether or not LX was enabled.

   The flag is read at build time as well as at runtime: — the community search endpoint LX falls back to, and the only host that serves LX cover art — is added to the image optimizer's only when is set for the build. A default build allows Jamendo, ccMixter and Apple artwork and nothing else. This used to be untrue: the host sat unconditionally in the artwork allowlist, so every deployment permitted it whether or not LX was on.

3. Start development:

   ```bash
   npm run dev
   ```

4. Open [http://localhost:3000](http://localhost:3000).

Curated Pop, J-Pop, and Classical views use verified Jamendo tracks. Trending combines provider-backed Jamendo and ccMixter signals; federated search can include verified Archive tracks after exact media and licensing metadata are resolved. Albums are provider-backed summaries, and ccMixter/Archive remain available where their metadata satisfies the app's provenance and playback requirements. When a provider fails, healthy provider results remain available and the UI reports the degraded source honestly.

LX Music custom sources are intentionally unsupported, even when LX is enabled. The application never downloads or executes arbitrary custom-source scripts. Those scripts are executable, undocumented provider adapters rather than a stable, rights-cleared HTTP API; running them would bypass this app's host validation and credential boundaries.

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
- The bottom player height and the clearance the scrolling pane leaves for it are one pair of CSS custom properties, `--player-bar-height` (72px) and `--player-bar-clearance`, rather than two numbers written out separately in the bar and the shell.

## Providers and streaming

Browser requests go through `src/app/api/music/[...path]/route.ts`, which keeps credentials server-side, validates provider input, forwards media byte ranges, and preserves upstream media statuses. Search can return partial results when one provider fails.

Artwork is served by Next's own image optimizer, configured in . is the single artwork allowlist, shared with the client-side guard in so the browser and the optimizer cannot disagree about which hosts are permitted. is set deliberately: the optimizer follows an upstream redirect without re-checking against the new location, and every artwork host answers directly, so no hop is needed.

Media streams are proxied by , which fetches with and checks every hop against a per-provider host allowlist before following it.

Artwork is served by Next's own image optimizer, configured in `next.config.ts`. `images.remotePatterns` is the single artwork allowlist, shared with the client-side guard in `src/lib/artworkHosts.ts` so the browser and the optimizer cannot disagree about which hosts are permitted. `maximumRedirects: 0` is set deliberately: the optimizer follows an upstream redirect _without_ re-checking `remotePatterns` against the new location, and every artwork host answers directly, so no hop is needed.

Media streams are proxied by `src/app/api/music/streamProxy.ts`, which fetches with `redirect: 'manual'` and validates every hop against a per-provider host allowlist before following it. The allowlists are measured, not assumed: Jamendo and Apple answer their stream URLs directly, while Archive redirects to a per-node `*.archive.org` host.

The built-in rate limiter is a bounded, best-effort guard keyed by trusted proxy client address and route bucket. Its state is local to one application instance. Production deployments that need deployment-wide enforcement must add a distributed or platform-level rate limit and ensure the proxy overwrites `X-Real-IP` or `X-Forwarded-For`.

### ccMixter response headers

ccMixter's API returns its JSON payload in an `X-JSON` response header rather than the body, and that is its only response mode carrying file and license data. The payload passes Node's default 16 KB header cap after a handful of records, so `npm run dev` and `npm start` raise the limit through `NODE_OPTIONS=--max-http-header-size` (see `scripts/next-with-large-headers.mjs`). Any other way of starting the server — a custom container command, or a platform that sets its own start command — needs the same option, otherwise ccMixter catalogs degrade to far fewer records and many more upstream round trips. The proxy stays correct without it: it retries with progressively smaller pages instead of failing.

## Deployment

Set `JAMENDO_CLIENT_ID` separately in each Vercel environment where Jamendo should be enabled; Preview and Production do not automatically share values. LX also requires an explicit `NEXT_PUBLIC_LX_ENABLED=true` in each environment, plus reviewed server-side endpoint configuration. Never store or log a Jamendo client secret. If any secret is pasted into chat, logs, or another shared surface, revoke and rotate it in the Jamendo developer portal.

Deploy and smoke-test a Preview before publishing Production. The local `.vercel` directory contains machine-specific linkage and should remain private.

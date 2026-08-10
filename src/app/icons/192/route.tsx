import { appIcon } from '../appIcon';

/** Static route so the manifest can name a stable URL; regenerated at build. */
export const dynamic = 'force-static';

export function GET(): Response {
  return appIcon(192, false);
}

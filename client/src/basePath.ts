/**
 * Mount prefix for the app, without a trailing slash.
 *
 * Vite sets import.meta.env.BASE_URL from the `base` option in
 * vite.config.ts — "/simgame/" on the HR platform, "/" everywhere else.
 * Trimming the trailing slash gives "/simgame" or "", so withBase() composes
 * cleanly and root-mounted builds are unaffected.
 *
 * Vite rewrites asset URLs it can see (index.html, imported modules) but not
 * strings written in JSX, so <img src>, <a href> and the Socket.IO path go
 * through here.
 */
export const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

export const withBase = (path: string): string => `${BASE}${path}`;

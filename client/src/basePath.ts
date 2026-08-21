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

/**
 * The absolute link a controller hands to players for one game.
 *
 * Built from window.location.origin so it is correct wherever the app is
 * served — hr.rdcc.ai/simgame in production, localhost in development —
 * without a base URL having to be configured anywhere.
 */
export const playerJoinUrl = (code: string): string =>
    `${window.location.origin}${BASE}/?g=${encodeURIComponent(code)}`;

/**
 * The code out of whatever the controller pasted.
 *
 * People paste the whole link far more often than the six characters, so
 * accept either rather than making them edit it down.
 */
export const readJoinCode = (input: string): string => {
    const text = (input || '').trim();
    const fromUrl = text.match(/[?&]g=([^&\s]+)/);
    return (fromUrl ? decodeURIComponent(fromUrl[1]) : text).trim().toUpperCase();
};

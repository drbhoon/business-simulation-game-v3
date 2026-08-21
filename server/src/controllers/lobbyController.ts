import { randomInt } from 'crypto';
import { query } from '../db';
import { Team, GameState } from '../engine/types';

/**
 * The join code that turns the fixed player URL into a per-game link.
 *
 * Players used to be given one permanent address, so a link from a session
 * three months ago still walked straight into today's game. The code is a
 * property of the GAME: every reset issues a new one, which is what makes the
 * previous link stop working.
 *
 * It is a share token, not a password. It stops a stale link and a wrong room
 * from joining; it is not protection against someone who is given the current
 * code and should not have it.
 */
// No O/0 or I/1 — the controller reads this out to a room.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function newJoinCode(length = 6): string {
    let code = '';
    for (let i = 0; i < length; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
    return code;
}

/** Issue a fresh code, retiring the current one. */
export async function rotateJoinCode(): Promise<string> {
    const code = newJoinCode();
    await query(
        'UPDATE game_state SET join_code = ?, last_updated = datetime("now") WHERE id = 1',
        [code]
    );
    return code;
}

/**
 * The code for the game running now, minting one if the row has none.
 *
 * A database that existed before this feature has join_code NULL, and so does
 * one whose migration has not run yet. Either way the controller must be able
 * to hand out a link, so the first read creates it rather than failing.
 */
export async function getJoinCode(): Promise<string> {
    const result = await query('SELECT join_code as "joinCode" FROM game_state WHERE id = 1');
    const existing = (result.rows[0]?.joinCode || '').trim();
    return existing || await rotateJoinCode();
}

/** Case- and space-insensitive: the code gets typed in by hand. */
export async function joinCodeMatches(candidate: string | undefined | null): Promise<boolean> {
    const given = (candidate || '').trim().toUpperCase();
    if (!given) return false;
    return given === (await getJoinCode()).toUpperCase();
}

export async function createTeam(name: string, pinCode: string): Promise<Team> {
    // 0. Check capacity
    const { rows: countRes } = await query('SELECT COUNT(*) as count FROM teams');
    const currentCount = countRes[0]?.count || 0;

    // 1. Insert (only if < 10 or if unique check fails later)
    // Actually, we must check duplicate name first? 
    // If we check duplicate name first, we allow re-login flow to pass to 'catch'.
    // If we check capacity first, we block NEW teams, but we might also block re-login flow 
    // if we throw strictly.
    // However, re-login relies on createTeam failing.
    
    // Strategy: We want to ALLOW duplicate-name error to happen (so re-login works),
    // but BLOCK non-duplicate new team if full.
    
    // Let's check if name exists.
    const { rows: exists } = await query('SELECT id FROM teams WHERE name = ?', [name]);
    if (exists.length > 0) {
        // Name exists, let it fail unique constraint (or throw specific error to catch)
        throw new Error("Team Name Exists"); 
    }

    if (currentCount >= 10) {
        throw new Error("Game is Full Now. Contact Controller");
    }

    await query(
        'INSERT INTO teams (name, pin_code, base_tm_count) VALUES (?, ?, 0)',
        [name, pinCode]
    );

    // 2. Select back
    const result = await query('SELECT id, name, pin_code as "pinCode", base_tm_count as "baseTmCount" FROM teams WHERE name = ?', [name]);
    return result.rows[0];
}

export async function getTeams(): Promise<Team[]> {
    const result = await query('SELECT id, name, pin_code as "pinCode", base_tm_count as "baseTmCount" FROM teams ORDER BY created_at');
    return result.rows;
}

export async function getGameState(): Promise<GameState> {
    const result = await query('SELECT id, current_quarter as "currentQuarter", current_month_within_quarter as "currentMonthWithinQuarter", phase, market_size_current_month as "marketSizeCurrentMonth", is_paused as "isPaused" FROM game_state WHERE id = 1');
    if (!result.rows || result.rows.length === 0) {
        // Fallback if not init (should be init)
        return {
            id: 1, currentQuarter: 0, currentMonthWithinQuarter: 0, phase: 'LOBBY', marketSizeCurrentMonth: 0, isPaused: false
        } as any;
    }
    return result.rows[0];
}

export async function updateGamePhase(phase: string): Promise<GameState> {
    await query(
        'UPDATE game_state SET phase = ?, last_updated = datetime("now") WHERE id = 1',
        [phase]
    );
    const result = await query('SELECT id, current_quarter as "currentQuarter", current_month_within_quarter as "currentMonthWithinQuarter", phase, market_size_current_month as "marketSizeCurrentMonth", is_paused as "isPaused" FROM game_state WHERE id = 1');
    return result.rows[0];
    return result.rows[0];
}

export async function transitionToMonthStart(quarter: number, month: number): Promise<GameState> {
    await query(
        `UPDATE game_state 
         SET phase = 'MONTH_START', 
             current_quarter = ?, 
             current_month_within_quarter = ?,
             last_updated = datetime("now") 
         WHERE id = 1`,
        [quarter, month]
    );
    return await getGameState();
}

export async function loginTeam(name: string, pinCode: string): Promise<Team | null> {
    const result = await query(
        'SELECT id, name, pin_code as "pinCode", base_tm_count as "baseTmCount" FROM teams WHERE name = ? AND pin_code = ?',
        [name, pinCode]
    );
    return result.rows[0] || null;
}

/**
 * End the current game and start a clean one.
 *
 * Rotating the code is part of the reset, not a separate button: a new game
 * IS a new link, and leaving the old one alive would let a team from the
 * finished session rejoin the next one.
 */
export async function resetGame(): Promise<GameState> {
    // 1. Clear Bids (RM, Auction, etc.) and Financials
    await query('DELETE FROM rm_bids');
    await query('DELETE FROM customer_bids');
    await query('DELETE FROM financials');
    await query('DELETE FROM extra_tms');

    // 2. Clear Teams
    await query('DELETE FROM teams');

    // 3. Reset Game State to Lobby, Quarter 0, on a NEW link
    await query(
        `UPDATE game_state
         SET phase = 'LOBBY',
             current_quarter = 0,
             current_month_within_quarter = 0,
             join_code = ?,
             last_updated = datetime("now")
         WHERE id = 1`,
        [newJoinCode()]
    );

    return await getGameState();
}

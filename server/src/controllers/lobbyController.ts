import { query } from '../db';
import { Team, GameState } from '../engine/types';

export async function createTeam(name: string, pinCode: string): Promise<Team> {
    // 1. Insert
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

export async function resetGame(): Promise<GameState> {
    // 1. Clear Bids (RM, Auction, etc.) and Financials
    await query('DELETE FROM rm_bids');
    await query('DELETE FROM customer_bids');
    await query('DELETE FROM financials');
    await query('DELETE FROM extra_tms');

    // 2. Clear Teams
    await query('DELETE FROM teams');

    // 3. Reset Game State to Lobby, Quarter 0
    await query(
        `UPDATE game_state 
         SET phase = 'LOBBY', 
             current_quarter = 0, 
             current_month_within_quarter = 0,
             last_updated = datetime("now") 
         WHERE id = 1`
    );

    return await getGameState();
}

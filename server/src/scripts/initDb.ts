import fs from 'fs';
import path from 'path';
import { query, getClient } from '../db';
import { getJoinCode } from '../controllers/lobbyController';

async function initDb() {
    console.log('Initializing Database...');
    const client = await getClient();
    try {
        console.log('Executing schema SQL (Version: Inlined for Production Safety)...');

        // Inline schema to prevent 'file not found' crashes in production builds where .sql files aren't copied to dist
        const schemaSql = `
-- SQLite Schema for RMX Business Simulation Game

-- Teams Table
CREATE TABLE IF NOT EXISTS teams (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    pin_code TEXT NOT NULL,
    base_tm_count INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Game State
CREATE TABLE IF NOT EXISTS game_state (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    current_quarter INTEGER DEFAULT 1,
    current_month_within_quarter INTEGER DEFAULT 1,
    phase TEXT DEFAULT 'LOBBY',
    market_size_current_month INTEGER DEFAULT 250000,
    is_paused INTEGER DEFAULT 0, -- Boolean as 0/1
    last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- RM Bids (V3: Monthly Bidding)
CREATE TABLE IF NOT EXISTS rm_bids (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    quarter_id INTEGER NOT NULL,
    month_id INTEGER NOT NULL,
    team_id INTEGER REFERENCES teams(id),
    bid_price_paise INTEGER NOT NULL,
    bid_volume INTEGER NOT NULL,
    rank INTEGER,
    allocated_volume INTEGER DEFAULT 0,
    is_locked INTEGER DEFAULT 0,
    UNIQUE(quarter_id, month_id, team_id)
);

-- Extra TMs
CREATE TABLE IF NOT EXISTS extra_tms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    team_id INTEGER REFERENCES teams(id),
    quarter_int INTEGER NOT NULL,
    month_int INTEGER NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,
    UNIQUE(team_id, quarter_int, month_int)
);

-- Customer Auction Bids
CREATE TABLE IF NOT EXISTS customer_bids (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    quarter_id INTEGER NOT NULL,
    month_id INTEGER NOT NULL,
    team_id INTEGER REFERENCES teams(id),
    customer_id TEXT NOT NULL,
    bid_price_paise INTEGER NOT NULL,
    bid_volume INTEGER NOT NULL,
    rank INTEGER,
    allocated_volume INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(quarter_id, month_id, team_id, customer_id)
);

-- Financial Snapshots
CREATE TABLE IF NOT EXISTS financials (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    team_id INTEGER REFERENCES teams(id),
    quarter_int INTEGER NOT NULL,
    month_int INTEGER NOT NULL,
    
    revenue_paise INTEGER DEFAULT 0,
    rm_cost_paise INTEGER DEFAULT 0,
    tm_cost_paise INTEGER DEFAULT 0,
    prod_cost_paise INTEGER DEFAULT 0,
    expenses_paise INTEGER DEFAULT 0,
    ebitda_paise INTEGER DEFAULT 0,
    sales_volume INTEGER DEFAULT 0,
    receivables_paise INTEGER DEFAULT 0,
    
    cash_opening_paise INTEGER DEFAULT 0,
    cash_closing_paise INTEGER DEFAULT 0,
    loan_outstanding_paise INTEGER DEFAULT 0,
    interest_paid_paise INTEGER DEFAULT 0,
    
    rm_opening_balance INTEGER DEFAULT 0,
    rm_closing_balance INTEGER,
    tm_count_current INTEGER,
    
    extra_rm_volume INTEGER DEFAULT 0,
    extra_rm_cost_per_m3_paise INTEGER DEFAULT 0,
    extra_tm_count INTEGER DEFAULT 0,
    
    UNIQUE(team_id, quarter_int, month_int)
);

-- Ledger
CREATE TABLE IF NOT EXISTS ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    team_id INTEGER REFERENCES teams(id),
    amount_paise INTEGER NOT NULL,
    category TEXT NOT NULL,
    description TEXT,
    transaction_date DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Initial Seed Data
INSERT OR IGNORE INTO game_state (id, current_quarter, phase) VALUES (1, 0, 'LOBBY');
`;

        await client.query('BEGIN');
        await client.query(schemaSql);
        await client.query('COMMIT');

        // Per-game join code. CREATE TABLE IF NOT EXISTS leaves an existing
        // game_state untouched, so the column has to be added separately.
        // SQLite has no ADD COLUMN IF NOT EXISTS; re-running is what makes
        // this idempotent, so the second attempt is expected to complain.
        try {
            await query('ALTER TABLE game_state ADD COLUMN join_code TEXT');
            console.log('[DB] added game_state.join_code');
        } catch (err: any) {
            if (!/duplicate column name/i.test(err?.message || '')) throw err;
        }
        // Mints one if the row has none, so the controller always has a link
        // to hand out — including on the very first boot after this deploy.
        console.log(`[DB] player join code for the current game: ${await getJoinCode()}`);

        console.log('Database initialized successfully.');
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error initializing database:', err);
        process.exit(1);
    } finally {
        client.release();
        process.exit(0);
    }
}

initDb();

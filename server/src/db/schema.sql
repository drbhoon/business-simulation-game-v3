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

-- RM Bids
CREATE TABLE IF NOT EXISTS rm_bids (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    quarter_id INTEGER NOT NULL,
    team_id INTEGER REFERENCES teams(id),
    bid_price_paise INTEGER NOT NULL,
    bid_volume INTEGER NOT NULL,
    rank INTEGER,
    allocated_volume INTEGER DEFAULT 0,
    is_locked INTEGER DEFAULT 0,
    UNIQUE(quarter_id, team_id)
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
    
    cash_opening_paise INTEGER DEFAULT 0,
    cash_closing_paise INTEGER DEFAULT 0,
    loan_outstanding_paise INTEGER DEFAULT 0,
    interest_paid_paise INTEGER DEFAULT 0,
    
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

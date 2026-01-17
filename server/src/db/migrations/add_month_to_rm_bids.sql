-- Migration: Add month_id to rm_bids for V3 Monthly Bidding
-- This allows teams to bid on RM/TM every month instead of once per quarter

-- Step 1: Create new table with month_id
CREATE TABLE IF NOT EXISTS rm_bids_new (
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

-- Step 2: Copy existing data (assume all old bids are for month 1)
INSERT INTO rm_bids_new (id, quarter_id, month_id, team_id, bid_price_paise, bid_volume, rank, allocated_volume, is_locked)
SELECT id, quarter_id, 1, team_id, bid_price_paise, bid_volume, rank, allocated_volume, is_locked
FROM rm_bids;

-- Step 3: Drop old table
DROP TABLE rm_bids;

-- Step 4: Rename new table
ALTER TABLE rm_bids_new RENAME TO rm_bids;

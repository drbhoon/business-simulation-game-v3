-- Add rm_opening_balance column to financials table
ALTER TABLE financials ADD COLUMN rm_opening_balance INTEGER DEFAULT 0;

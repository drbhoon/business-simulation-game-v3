
import { query } from '../db';

async function fixSchema() {
    try {
        console.log("Running migration: Adding receivables_paise to financials table...");
        await query(`ALTER TABLE financials ADD COLUMN receivables_paise INTEGER DEFAULT 0;`);
        console.log("Migration successful!");
    } catch (err: any) {
        if (err.message && err.message.includes('duplicate column name')) {
            console.log("Column already exists. Skipping.");
        } else {
            console.error("Migration failed:", err);
        }
    }
}

fixSchema();

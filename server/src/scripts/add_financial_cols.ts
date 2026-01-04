
import { query } from '../db';

(async () => {
    console.log("Adding columns to financials table...");
    try {
        await query(`ALTER TABLE financials ADD COLUMN rm_closing_balance INTEGER DEFAULT 0`);
        console.log("Added rm_closing_balance column.");
    } catch (e: any) {
        console.log("rm_closing_balance might already exist: " + e.message);
    }

    try {
        await query(`ALTER TABLE financials ADD COLUMN tm_count_current INTEGER DEFAULT 0`);
        console.log("Added tm_count_current column.");
    } catch (e: any) {
        console.log("tm_count_current might already exist: " + e.message);
    }

    console.log("Done.");
})();

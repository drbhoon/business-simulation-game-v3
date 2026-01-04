
import { query } from '../db';

async function debugValues() {
    try {
        const teamId = 26; // Assuming Team 26 from previous log

        const rm = await query(`SELECT allocated_volume, bid_price_paise FROM rm_bids WHERE quarter_id=1 AND team_id=${teamId}`);
        const cust = await query(`SELECT SUM(allocated_volume) as total_sold FROM customer_bids WHERE quarter_id=1 AND month_id=1 AND team_id=${teamId}`);

        console.log("RM Allocation:", rm.rows[0]);
        console.log("Total Sold:", cust.rows[0]);
    } catch (e) { console.error(e); }
}
debugValues();

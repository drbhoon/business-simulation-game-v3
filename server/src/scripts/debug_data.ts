
import { query } from '../db';
import { CONSTANTS } from '../engine/types';

async function debugData() {
    try {
        console.log("--- RM BIDS (Q1) ---");
        const rmBids = await query(`SELECT * FROM rm_bids WHERE quarter_id = 1`);
        console.table(rmBids.rows);

        console.log("\n--- CUSTOMER BIDS (Q1, Month 1) ---");
        const custBids = await query(`SELECT team_id, customer_id, bid_price_paise, allocated_volume FROM customer_bids WHERE quarter_id = 1 AND month_id = 1`);
        console.table(custBids.rows);

        console.log("\n--- FINANCIALS (Q1, Month 1) ---");
        const financials = await query(`SELECT team_id, revenue_paise, rm_cost_paise, tm_cost_paise, prod_cost_paise, expenses_paise, ebitda_paise FROM financials WHERE quarter_int = 1 AND month_int = 1`);
        console.table(financials.rows);

        // Manual Recalc check for ALL teams
        for (const f of financials.rows) {
            const calcEbitda = f.revenue_paise - f.rm_cost_paise - f.tm_cost_paise - f.prod_cost_paise - f.expenses_paise;
            console.log(`\nManual Check for Team ${f.team_id}:`);
            console.log(`Revenue: ${f.revenue_paise}`);
            console.log(`RM Cost: ${f.rm_cost_paise}`);
            console.log(`TM Cost: ${f.tm_cost_paise}`);
            console.log(`Prod Cost: ${f.prod_cost_paise}`);
            console.log(`Expenses: ${f.expenses_paise}`);
            console.log(`DB EBITDA: ${f.ebitda_paise}`);
            console.log(`Manual EBITDA: ${calcEbitda}`);
            console.log(`Diff: ${f.ebitda_paise - calcEbitda}`);
            if (f.ebitda_paise - calcEbitda !== 0) {
                console.error(`MISMATCH DETECTED FOR TEAM ${f.team_id}!`);
            }
        }

    } catch (err) {
        console.error(err);
    }
}

debugData();

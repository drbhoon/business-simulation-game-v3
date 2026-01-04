import { query } from '../db';
import { CONSTANTS, RMBid } from '../engine/types';
import { calculateRMAllocations } from '../engine/allocations';

export async function submitQuarterBid(teamId: number, quarterId: number, bidPricePaise: number, bidVolume: number, tmCount: number) {
    // Validate basics
    if (bidPricePaise < CONSTANTS.MIN_BID_PRICE_PAISE) {
        throw new Error(`Minimum bid price is ${(CONSTANTS.MIN_BID_PRICE_PAISE / 100).toFixed(2)}`);
    }
    // Max price cap check
    if (bidPricePaise > 5000 * 100) {
        throw new Error("Maximum RM bid price is 5000");
    }

    // Max volume cap check (Production Capacity * 3 Months)
    if (bidVolume > 150000) {
        throw new Error("Maximum RM bid volume cannot exceed 150,000 m³");
    }

    // 1. Save RM Bid
    await query(
        `INSERT OR REPLACE INTO rm_bids (quarter_id, team_id, bid_price_paise, bid_volume, is_locked) 
         VALUES (?, ?, ?, ?, 1)`,
        [quarterId, teamId, bidPricePaise, bidVolume]
    );

    // 2. Update TM count
    await query(
        `UPDATE teams SET base_tm_count = ? WHERE id = ?`,
        [tmCount, teamId]
    );

    return { success: true };
}

export async function processQuarterAllocations(quarterId: number) {
    // 1. Fetch all bids
    const { rows: bids } = await query(
        `SELECT team_id as "teamId", bid_price_paise as "bidPricePaise", bid_volume as "bidVolume" 
         FROM rm_bids WHERE quarter_id = ?`,
        [quarterId]
    );

    if (bids.length === 0) return [];

    // 2. Run Engine
    const results = calculateRMAllocations(bids);

    // 3. Save Results
    for (const res of results) {
        await query(
            `UPDATE rm_bids 
             SET rank = ?, allocated_volume = ? 
             WHERE quarter_id = ? AND team_id = ?`,
            [res.rank, res.allocatedVolume, quarterId, res.teamId]
        );
    }

    return results;
}

export async function hasAllTeamsBid(quarterId: number): Promise<boolean> {
    const { rows: teamCountRow } = await query(`SELECT count(*) as c FROM teams`);
    const { rows: bidCountRow } = await query(`SELECT count(*) as c FROM rm_bids WHERE quarter_id = ?`, [quarterId]);

    return (bidCountRow[0].c >= teamCountRow[0].c);
}

export async function getQuarterAllocations(quarterId: number) {
    // Return formatted allocation results from DB
    const { rows } = await query(
        `SELECT team_id as "teamId", bid_price_paise as "bidPricePaise", bid_volume as "bidVolume",
                rank, allocated_volume as "allocatedVolume"
         FROM rm_bids 
         WHERE quarter_id = ? AND rank IS NOT NULL 
         ORDER BY rank ASC`,
        [quarterId]
    );

    // Calculate factor for display (alloc / bid)
    return rows.map((r: any) => ({
        ...r,
        allocationFactor: r.bidVolume > 0 ? r.allocatedVolume / r.bidVolume : 0
    }));
}

// --- Customer Auction ---

// --- Customer Auction ---

export async function submitCustomerBid(teamId: number, quarterId: number, customerId: string, askPricePaise: number, askQty: number) {
    // BASIC VALIDATION
    if (askPricePaise <= 0) throw new Error("Price must be positive");
    if (askQty <= 0) throw new Error("Quantity must be positive");

    // Fetch current month from Game State to ensure we bid for the active month
    const { rows: gs } = await query(`SELECT current_month_within_quarter FROM game_state WHERE id = 1`);
    const currentMonth = gs[0]?.current_month_within_quarter || 1;

    console.log(`[QuarterController] Submitting Customer Bid: Q${quarterId} M${currentMonth} Team=${teamId} Cust=${customerId} Price=${askPricePaise}`);

    // Use INSERT OR REPLACE to handle re-bids within same phase
    await query(
        `INSERT OR REPLACE INTO customer_bids (quarter_id, month_id, team_id, customer_id, bid_price_paise, bid_volume)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [quarterId, currentMonth, teamId, customerId, askPricePaise, askQty]
    );
    return { success: true };
}

export async function processCustomerAllocations(quarterId: number) {
    // Fetch current month to process
    const { rows: gs } = await query(`SELECT current_month_within_quarter FROM game_state WHERE id = 1`);
    const monthId = gs[0]?.current_month_within_quarter || 1;

    // 1. Get distinct customers bid on
    const { rows: customers } = await query(
        `SELECT DISTINCT customer_id FROM customer_bids WHERE quarter_id = ? AND month_id = ?`,
        [quarterId, monthId]
    );

    const allResults = [];

    for (const cust of customers) {
        const customerId = cust.customer_id;

        // 2. Fetch bids for this customer
        const { rows: bids } = await query(
            `SELECT team_id as "teamId", bid_price_paise as "askPricePaise", bid_volume as "askQty"
             FROM customer_bids 
             WHERE quarter_id = ? AND month_id = ? AND customer_id = ?`,
            [quarterId, monthId, customerId]
        );

        if (bids.length === 0) continue;

        // 3. Determine Market Size
        // User Rule: Total Market = Team Count * 40,000
        const { rows: teamCountRow } = await query(`SELECT count(*) as c FROM teams`);
        const teamCount = teamCountRow[0]?.c || 0;
        const totalMarket = teamCount * 40000;

        const shareMap: Record<string, number> = { 'LADDU': 0.4, 'SHAHI': 0.3, 'LEMON': 0.2, 'JAMOON': 0.1 };
        const share = shareMap[customerId] || 0.25;

        // Exact demand for this customer
        const customerDemand = Math.floor(totalMarket * share);

        // 4. Calculate
        const { calculateCustomerAllocations } = require('../engine/allocations');
        const allocations = calculateCustomerAllocations(bids, customerDemand);

        // 5. Save
        for (const res of allocations) {
            await query(
                `UPDATE customer_bids 
                 SET rank = ?, allocated_volume = ?
                 WHERE quarter_id = ? AND month_id = ? AND team_id = ? AND customer_id = ?`,
                [res.rank, res.allocatedVolume, quarterId, monthId, res.teamId, customerId]
            );
        }
        allResults.push(...allocations);
    }
    return allResults;
}

export async function getCustomerAllocations(quarterId: number, monthId?: number) {
    let targetMonth = monthId;
    if (!targetMonth) {
        const { rows: gs } = await query(`SELECT current_month_within_quarter FROM game_state WHERE id = 1`);
        targetMonth = gs[0]?.current_month_within_quarter || 1;
    }

    const { rows } = await query(
        `SELECT team_id as "teamId", customer_id as "customerId", 
                bid_price_paise as "bidPricePaise", bid_volume as "bidVolume",
                rank, allocated_volume as "allocatedVolume"
         FROM customer_bids
         WHERE quarter_id = ? AND month_id = ?
         ORDER BY customer_id, rank ASC`,
        [quarterId, targetMonth]
    );
    return rows;
}

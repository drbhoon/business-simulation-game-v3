import { query } from '../db';
import { CONSTANTS, CUSTOMERS } from '../engine/types';

export async function calculateMonthlyFinancials(quarterId: number, monthId: number) {
    // 1. Get all teams
    const { rows: teams } = await query(`SELECT id, base_tm_count FROM teams`);

    // CLEANUP: Delete existing records for this month to allow recalculation
    await query(`DELETE FROM financials WHERE quarter_int = ? AND month_int = ?`, [quarterId, monthId]);

    for (const team of teams) {
        const teamId = team.id;

        // --- REVENUE & RECEIVABLES ---
        // Get winning bids for this team (Allocated Volume)
        const { rows: wins } = await query(
            `SELECT cb.customer_id, cb.bid_price_paise, cb.allocated_volume 
             FROM customer_bids cb
             WHERE cb.quarter_id = ? AND cb.month_id = ? AND cb.team_id = ? AND cb.allocated_volume > 0`,
            [quarterId, monthId, teamId]
        );

        let totalRevenuePaise = 0;
        let cashInflowFromSalesPaise = 0;
        let receivablesPaise = 0;

        for (const win of wins) {
            const revenue = win.allocated_volume * win.bid_price_paise;
            totalRevenuePaise += revenue;

            // Payment Terms Logic
            const customer = CUSTOMERS.find(c => c.id === win.customer_id);
            const payTerm = customer?.payTermDays || 0;

            if (payTerm === 0) {
                // Cash Immediate
                cashInflowFromSalesPaise += revenue;
            } else {
                // Receivable (Cash comes later)
                receivablesPaise += revenue;
                // FUTURE TODO: Create a 'future_cash_inflows' record for Month + 1 or + 2
            }
        }

        // --- COSTS ---

        // 1. RM Cost
        // Get RM Allocation for this quarter (Assuming passed parameter month allocation logic needs to check if RM is monthly or quarterly)
        // Currently RM is allocated once per Quarter (Start).
        // Let's assume RM cost is paid in Month 1 of Quarter (Upfront).
        // If monthId > 1, RM Cost might be 0 (unless we split it).
        // For simple MVP Q1 M1: Charge full RM Cost now? Or 1/3?
        // Let's charge FULL allocated RM cost in Month 1 since they buy it at start.
        // 3. Production Cost
        const totalVol = wins.reduce((sum, w) => sum + w.allocated_volume, 0);

        // --- COSTS REFINEMENT ---
        // 1. RM Cost
        // EBITDA View: Cost of Goods Sold (Consumption) = Sold Volume * RM Pice
        // Checking for Spot Purchase (Excess Sales > Available RM)

        let rmCostConsumedPaise = 0;
        let rmPurchaseCostPaise = 0;
        let spotPurchaseCostPaise = 0;

        // Fetch My RM Bid for Price and Volume
        const { rows: rmBid } = await query(
            `SELECT bid_price_paise, allocated_volume FROM rm_bids WHERE quarter_id = ? AND team_id = ?`,
            [quarterId, teamId]
        );

        // Fetch Highest RM Bid Price for Spot Calculation
        const { rows: maxBidRows } = await query(
            `SELECT MAX(bid_price_paise) as max_price FROM rm_bids WHERE quarter_id = ?`,
            [quarterId]
        );
        const maxRmBidPrice = maxBidRows[0]?.max_price || 5000 * 1000; // Default fallback if no bids

        if (rmBid.length > 0) {
            const myRmPrice = rmBid[0].bid_price_paise;
            const myRmVol = rmBid[0].allocated_volume; // Total RM for Quarter

            // Calculate Excess
            // Note: This check only works effectively for 'Cumulative' sales if we track previous months.
            // For M1, it's Total Vol M1 vs Total RM.
            // Future TODO: Subtract previous months' consumption from myRmVol to get 'Available RM'.

            let normalRmVol = totalVol;
            let excessVol = 0;

            if (totalVol > myRmVol) {
                normalRmVol = myRmVol;
                excessVol = totalVol - myRmVol;
            }

            // Normal Consumption
            rmCostConsumedPaise = normalRmVol * myRmPrice;

            // Spot Purchase Penalty
            if (excessVol > 0) {
                const spotPrice = maxRmBidPrice * 1.10; // Highest + 10%
                spotPurchaseCostPaise = excessVol * spotPrice;
                rmCostConsumedPaise += spotPurchaseCostPaise; // Add to total RM Consumed Cost
            }

            // Purchase Cost (for Cash) - Only if M1 (assuming bulk buy of Normal RM)
            // Spot Purchase is immediate cash outflow too? Lets assume yes.
            if (monthId === 1) {
                rmPurchaseCostPaise = (myRmVol * myRmPrice) + spotPurchaseCostPaise;
            } else {
                rmPurchaseCostPaise = spotPurchaseCostPaise; // Only spot cost in later months if excess
            }
        } else {
            // No RM allocated at all? Entire thing is Spot Purchase?
            // Or maybe they didn't bid? Assume Spot for ALL volume.
            const spotPrice = maxRmBidPrice * 1.10;
            rmCostConsumedPaise = totalVol * spotPrice;
            rmPurchaseCostPaise = rmCostConsumedPaise;
        }

        // 2. TM Cost
        const baseTmCost = team.base_tm_count * CONSTANTS.BASE_TM_COST_PAISE;
        const tmCostPaise = baseTmCost;

        // 3. Production Cost (Tiered)
        const tier = CONSTANTS.COST_TIERS.find(t => totalVol >= t.minVol);
        const prodRatePaise = tier ? tier.rate : 700 * 100;
        const prodCostPaise = totalVol * prodRatePaise;

        // 4. Other Expenses
        const expensesPaise = 500000 * 100;

        // --- CALCULATION OF RM BALANCE ---
        // Need cumulative sales for this quarter up to this month
        // We know 'totalVol' is for THIS month.
        // We need previous months' sales in this quarter if M > 1

        // 1. Get allocated RM for quarter (Already fetched as myRmVol if rmBid exists)
        const myRmVol = rmBid.length > 0 ? rmBid[0].allocated_volume : 0;

        // 2. Get Cumulative Sold for Quarter (This M + Previous Ms)
        // Since we are inside the 'calculate' function which is called for current month,
        // we can query the 'customer_bids' table for allocated volume for this Quarter & Team
        // for ALL months <= current monthId.

        const { rows: cumSales } = await query(
            `SELECT SUM(allocated_volume) as total_sold 
             FROM customer_bids 
             WHERE quarter_id = ? AND team_id = ? AND month_id <= ?`,
            [quarterId, teamId, monthId]
        );
        const totalSoldToDate = cumSales[0]?.total_sold || 0;

        // 3. Balance = Allocated - Sold
        // If Sold > Allocated, Balance is Negative (Spot Purchase logic handled in cost, but display needs negative)
        const rmClosingBalance = myRmVol - totalSoldToDate;

        // --- TM COUNT ---
        const currentTmCount = team.base_tm_count;

        // --- EBITDA ---
        // Revenue - RM(Consumed incl Spot) - TM - Prod - Expenses
        const totalCostsForEbitda = rmCostConsumedPaise + tmCostPaise + prodCostPaise + expensesPaise;
        const ebitdaPaise = totalRevenuePaise - totalCostsForEbitda;

        // --- CASH FLOW ---
        // Cash Outflows = RM(Purchase + Spot) + TM + Prod + Expenses
        const totalCashOutflow = rmPurchaseCostPaise + tmCostPaise + prodCostPaise + expensesPaise;

        // Opening Cash
        let openingCashPaise = 0;
        if (quarterId === 1 && monthId === 1) {
            openingCashPaise = CONSTANTS.SEED_WC_PAISE;
        } else {
            // Determine previous period
            let prevQuarter = quarterId;
            let prevMonth = monthId - 1;

            if (prevMonth < 1) {
                prevMonth = 3;
                prevQuarter = quarterId - 1;
            }

            if (prevQuarter < 1) {
                // Should not happen if Q=1 M=1 handled above, but fallback
                openingCashPaise = CONSTANTS.SEED_WC_PAISE;
            } else {
                // Fetch prev month closing
                const { rows: prevRows } = await query(
                    `SELECT cash_closing_paise FROM financials 
                     WHERE team_id = ? AND quarter_int = ? AND month_int = ?`,
                    [teamId, prevQuarter, prevMonth]
                );
                openingCashPaise = prevRows[0]?.cash_closing_paise || 0;
            }
        }

        const interestRateMonthly = 0.02; // 2% per month on Overdraft
        let interestPaise = 0;

        if (openingCashPaise < 0) {
            interestPaise = Math.abs(openingCashPaise) * interestRateMonthly;
        }

        const loanRepaymentPaise = 0;

        // --- CASH FLOW ---
        // Cash Outflows = RM(Purchase + Spot) + TM + Prod + Expenses
        // totalCashOutflow was already defined above at line 168.

        const closingCashPaise = openingCashPaise + cashInflowFromSalesPaise - totalCashOutflow - interestPaise - loanRepaymentPaise;

        // --- SAVE SNAPSHOT ---
        await query(
            `INSERT INTO financials (
                team_id, quarter_int, month_int,
                revenue_paise, rm_cost_paise, tm_cost_paise, prod_cost_paise, expenses_paise, ebitda_paise,
                cash_opening_paise, cash_closing_paise, receivables_paise,
                rm_closing_balance, tm_count_current, interest_paid_paise
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                teamId, quarterId, monthId,
                totalRevenuePaise, rmCostConsumedPaise, tmCostPaise, prodCostPaise, expensesPaise, ebitdaPaise,
                openingCashPaise, closingCashPaise, receivablesPaise,
                rmClosingBalance, currentTmCount, interestPaise
            ]
        );

    } // End Loop

    const { rows } = await query(
        `SELECT * FROM financials WHERE quarter_int = ? AND month_int = ?`,
        [quarterId, monthId]
    );
    return rows;
}

export async function getCumulativeFinancials(teamId: number, quarterId: number) {
    // 1. Current Quarter EBITDA
    const qEbitdaRes = await query(
        `SELECT SUM(ebitda_paise) as total_ebitda FROM financials WHERE team_id = ? AND quarter_int = ?`,
        [teamId, quarterId]
    );

    // 2. Total Game EBITDA (Cumulative across all quarters)
    const totalEbitdaRes = await query(
        `SELECT SUM(ebitda_paise) as total_ebitda FROM financials WHERE team_id = ?`,
        [teamId]
    );

    // 3. Current Month (Latest available in this quarter)
    const currentMonthRes = await query(
        `SELECT month_int, ebitda_paise, cash_closing_paise FROM financials 
         WHERE team_id = ? AND quarter_int = ? 
         ORDER BY month_int DESC LIMIT 1`,
        [teamId, quarterId]
    );

    // 4. Closing Cash (Latest globally)
    // Actually, closing cash of Q1 M3 IS the opening of Q2 M1, so latest record globally is fine.
    const cashRes = await query(
        `SELECT cash_closing_paise FROM financials 
         WHERE team_id = ? 
         ORDER BY quarter_int DESC, month_int DESC LIMIT 1`,
        [teamId]
    );

    return {
        quarterEbitdaPaise: qEbitdaRes.rows[0]?.total_ebitda || 0,
        totalGameEbitdaPaise: totalEbitdaRes.rows[0]?.total_ebitda || 0,
        closingCashPaise: cashRes.rows[0]?.cash_closing_paise || 0,
        currentMonth: {
            month: currentMonthRes.rows[0]?.month_int || 0,
            ebitda: currentMonthRes.rows[0]?.ebitda_paise || 0
        }
    };
}

export async function getAllTeamsFinancials(quarterId: number, monthId: number) {
    // Get financials for this specific month for all teams
    const { rows } = await query(
        `SELECT f.team_id, t.name as team_name, f.ebitda_paise, f.revenue_paise, f.cash_closing_paise 
         FROM financials f
         JOIN teams t ON f.team_id = t.id
         WHERE f.quarter_int = ? AND f.month_int = ?`,
        [quarterId, monthId]
    );
    return rows;
}

export async function getTeamFinancials(teamId: number, quarterId: number, monthId: number) {
    const { rows } = await query(
        `SELECT * FROM financials WHERE team_id = ? AND quarter_int = ? AND month_int = ?`,
        [teamId, quarterId, monthId]
    );
    return rows[0]; // Return the object directly or undefined
}

export async function getAllTeamsCumulativeFinancials(quarterId: number) {
    const { rows: teams } = await query(`SELECT id, name FROM teams`);
    const results = [];

    for (const team of teams) {
        // 1. Current Quarter Total EBITDA
        const { rows: qRes } = await query(
            `SELECT SUM(ebitda_paise) as total_ebitda FROM financials WHERE team_id = ? AND quarter_int = ?`,
            [team.id, quarterId]
        );
        // 2. Total Game (All Quarters) EBITDA
        const { rows: tRes } = await query(
            `SELECT SUM(ebitda_paise) as total_ebitda FROM financials WHERE team_id = ?`,
            [team.id]
        );

        results.push({
            teamId: team.id,
            teamName: team.name,
            quarterEbitdaPaise: qRes[0]?.total_ebitda || 0,
            totalGameEbitdaPaise: tRes[0]?.total_ebitda || 0
        });
    }
    // Sort by Total Game EBITDA descending
    results.sort((a, b) => b.totalGameEbitdaPaise - a.totalGameEbitdaPaise);
    return results;
}

export async function liquidateRemainingRM(quarterId: number) {
    console.log(`[Financials] Liquidating RM for Quarter ${quarterId}`);

    // 1. Get Lowest RM Bid Price for Valuation
    const { rows: minBidRows } = await query(
        `SELECT MIN(bid_price_paise) as min_price FROM rm_bids WHERE quarter_id = ? AND allocated_volume > 0`,
        [quarterId]
    );
    const liquidationPricePaise = minBidRows[0]?.min_price || 0;

    // 2. For each team, calculate Remaining RM
    const { rows: teams } = await query(`SELECT id FROM teams`);

    for (const team of teams) {
        // A. Total RM Allocated
        const { rows: rmRes } = await query(
            `SELECT allocated_volume FROM rm_bids WHERE quarter_id = ? AND team_id = ?`,
            [quarterId, team.id]
        );
        const totalAllocated = rmRes[0]?.allocated_volume || 0;

        // B. Total RM Consumed (Sum of all 3 months sales - minus any spot penalty logic?)
        // To be precise, we need to sum up allocated_volume from *customer_bids* for M1, M2, M3
        // BUT we need to clamp it to available RM if we were checking constraints.
        // Assuming financials calculation already handled the consumption cost for EBITDA properly.
        // We just need the Volume sold total.
        const { rows: salesRes } = await query(
            `SELECT SUM(allocated_volume) as total_sold 
             FROM customer_bids 
             WHERE quarter_id = ? AND team_id = ?`,
            [quarterId, team.id]
        );
        const totalSold = salesRes[0]?.total_sold || 0;

        // C. Calculate Remaining (Cannot be negative if sold was spot, but let's check)
        // If Sold > Allocated, then Remaining = 0 (Excess was Spot).
        // If Sold < Allocated, then Remaining = Allocated - Sold.
        let remainingRM = totalAllocated - totalSold;
        if (remainingRM < 0) remainingRM = 0;

        if (remainingRM > 0 && liquidationPricePaise > 0) {
            const liquidationValuePaise = remainingRM * liquidationPricePaise;
            console.log(`[Team ${team.id}] Liquidating ${remainingRM} units @ ${liquidationPricePaise} = ${liquidationValuePaise}`);

            // D. Credit to Month 3 (Quarter End) Financials
            // We update the existing Month 3 Financial Record by ADDING this to EBITDA and CASH and REVENUE (as Other Income?)
            // Technically it's "Other Income".
            // Let's modify EBITDA and Closing Cash.
            // CAUTION: Recalculating Month 3 later would wipe this if we don't persist it differently.
            // But usually Quarter closes and we don't recalc M3.

            await query(
                `UPDATE financials 
                 SET ebitda_paise = ebitda_paise + ?, 
                     cash_closing_paise = cash_closing_paise + ?,
                     revenue_paise = revenue_paise + ? 
                 WHERE team_id = ? AND quarter_int = ? AND month_int = 3`,
                [liquidationValuePaise, liquidationValuePaise, liquidationValuePaise, team.id, quarterId]
            );
        }
    }
}

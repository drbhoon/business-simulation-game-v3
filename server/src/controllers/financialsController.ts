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

        const totalVol = wins.reduce((sum, w) => sum + w.allocated_volume, 0);

        // --- 1. RM COST WITH INVENTORY TRACKING ---
        let rmCostConsumedPaise = 0;
        let rmPurchaseCostPaise = 0;
        let rmCarryingCostPaise = 0;
        let rmOpeningBalance = 0;
        let rmClosingBalance = 0;
        let extraRmVolume = 0;
        let extraRmCostPerM3Paise = 0;

        // Get previous month's RM closing balance
        if (monthId > 1 || quarterId > 1) {
            let prevQuarter = quarterId;
            let prevMonth = monthId - 1;
            if (prevMonth < 1) {
                prevMonth = 3;
                prevQuarter = quarterId - 1;
            }
            if (prevQuarter >= 1) {
                const { rows: prevFin } = await query(
                    `SELECT rm_closing_balance FROM financials WHERE team_id = ? AND quarter_int = ? AND month_int = ?`,
                    [teamId, prevQuarter, prevMonth]
                );
                rmOpeningBalance = prevFin[0]?.rm_closing_balance || 0;
            }
        }

        // Fetch My RM Bid for Price and Volume (for THIS month)
        const { rows: rmBid } = await query(
            `SELECT bid_price_paise, allocated_volume FROM rm_bids WHERE quarter_id = ? AND month_id = ? AND team_id = ?`,
            [quarterId, monthId, teamId]
        );

        // Fetch Highest RM Bid Price for Spot Calculation (for THIS month)
        const { rows: maxBidRows } = await query(
            `SELECT MAX(bid_price_paise) as max_price FROM rm_bids WHERE quarter_id = ? AND month_id = ?`,
            [quarterId, monthId]
        );
        const maxRmBidPrice = maxBidRows[0]?.max_price || 5000 * 100; // Default fallback

        const myRmPrice = rmBid.length > 0 ? rmBid[0].bid_price_paise : 0;
        const myRmAllocated = rmBid.length > 0 ? rmBid[0].allocated_volume : 0;

        // Total RM Available = Opening Balance + This Month's Allocation
        const totalRmAvailable = rmOpeningBalance + myRmAllocated;

        if (totalVol <= totalRmAvailable) {
            // SCENARIO A: Sufficient RM (Surplus or Exact)
            // Consume from available RM
            rmCostConsumedPaise = totalVol * myRmPrice;

            // Calculate surplus
            const surplus = totalRmAvailable - totalVol;

            if (surplus > 0) {
                // Carrying cost = 10% of RM value
                rmCarryingCostPaise = surplus * myRmPrice * 0.10;
                rmClosingBalance = surplus;
            } else {
                rmClosingBalance = 0;
            }

            // Cash outflow = ONLY this month's purchase (NO carrying cost in cash)
            rmPurchaseCostPaise = myRmAllocated * myRmPrice;

        } else {
            // SCENARIO B: Shortage - Need to buy extra at spot price
            const shortage = totalVol - totalRmAvailable;

            // Cost for available RM
            rmCostConsumedPaise = totalRmAvailable * myRmPrice;

            // Spot purchase at highest bid + 10%
            const spotPrice = maxRmBidPrice * 1.10;
            const spotCost = shortage * spotPrice;
            rmCostConsumedPaise += spotCost;

            // Cash outflow = This month's purchase + spot purchase
            rmPurchaseCostPaise = (myRmAllocated * myRmPrice) + spotCost;

            rmClosingBalance = 0; // All consumed

            // Track extra RM for display
            extraRmVolume = shortage;
            extraRmCostPerM3Paise = Math.round(spotPrice);
        }

        // --- 2. TM COST WITH EXTRA TM LOGIC ---
        const baseTmCount = team.base_tm_count;
        const tmCapacityPerUnit = 540; // m³ per TM per month
        const baseTmCapacity = baseTmCount * tmCapacityPerUnit;

        let tmCostPaise = baseTmCount * CONSTANTS.BASE_TM_COST_PAISE; // Base TM cost
        let extraTmCount = 0;

        if (totalVol > baseTmCapacity) {
            // Need extra TMs
            const requiredTms = Math.ceil(totalVol / tmCapacityPerUnit);
            extraTmCount = requiredTms - baseTmCount;
            const extraTmCost = extraTmCount * 280000 * 100; // ₹280,000 per extra TM (in paise)
            tmCostPaise += extraTmCost;
        }

        const currentTmCount = baseTmCount + extraTmCount;

        // --- 3. PRODUCTION COST (Tiered) ---
        const tier = CONSTANTS.COST_TIERS.find(t => totalVol >= t.minVol);
        const prodRatePaise = tier ? tier.rate : 700 * 100;
        const prodCostPaise = totalVol * prodRatePaise;

        // --- 4. OTHER EXPENSES ---
        const expensesPaise = 0; // No expenses defined

        // --- EBITDA ---
        // Revenue - RM(Consumed + Carrying Cost) - TM - Prod - Expenses
        const totalRmCostForEbitda = rmCostConsumedPaise + rmCarryingCostPaise;
        const totalCostsForEbitda = totalRmCostForEbitda + tmCostPaise + prodCostPaise + expensesPaise;
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
                sales_volume, cash_opening_paise, cash_closing_paise, receivables_paise,
                rm_opening_balance, rm_closing_balance, tm_count_current, interest_paid_paise,
                extra_rm_volume, extra_rm_cost_per_m3_paise, extra_tm_count
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                teamId, quarterId, monthId,
                totalRevenuePaise, totalRmCostForEbitda, tmCostPaise, prodCostPaise, expensesPaise, ebitdaPaise,
                totalVol, openingCashPaise, closingCashPaise, receivablesPaise,
                rmOpeningBalance, rmClosingBalance, currentTmCount, interestPaise,
                extraRmVolume, extraRmCostPerM3Paise, extraTmCount
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
    // Get financials for this specific month for all teams with ALL columns
    const { rows } = await query(
        `SELECT f.team_id, t.name as team_name, 
                f.revenue_paise, f.rm_cost_paise, f.tm_cost_paise, f.prod_cost_paise, 
                f.expenses_paise, f.ebitda_paise, f.sales_volume,
                f.cash_opening_paise, f.cash_closing_paise,
                f.rm_opening_balance, f.rm_closing_balance, f.tm_count_current, 
                f.receivables_paise, f.interest_paid_paise
         FROM financials f
         JOIN teams t ON f.team_id = t.id
         WHERE f.quarter_int = ? AND f.month_int = ?
         ORDER BY t.id ASC`,
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
    console.log(`[Financials] getAllTeamsCumulativeFinancials called for Q${quarterId}`);
    const { rows: teams } = await query(`SELECT id, name FROM teams`);
    console.log(`[Financials] Found ${teams.length} teams`);
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

    // 1. Get Lowest RM Bid Price for Valuation (from Month 3 bids)
    const { rows: minBidRows } = await query(
        `SELECT MIN(bid_price_paise) as min_price FROM rm_bids WHERE quarter_id = ? AND month_id = 3 AND allocated_volume > 0`,
        [quarterId]
    );
    const liquidationPricePaise = minBidRows[0]?.min_price || 0;

    // 2. For each team, calculate Remaining RM
    const { rows: teams } = await query(`SELECT id FROM teams`);

    for (const team of teams) {
        // A. Total RM Allocated (Sum across all 3 months)
        const { rows: rmRes } = await query(
            `SELECT SUM(allocated_volume) as total_allocated FROM rm_bids WHERE quarter_id = ? AND team_id = ?`,
            [quarterId, team.id]
        );
        const totalAllocated = rmRes[0]?.total_allocated || 0;

        // B. Total RM Consumed (Sum of all 3 months sales)
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

export async function getTeamCompleteHistory(teamId: number) {
    // 1. Fetch all financial records sorted by Q, M
    const { rows: financialRecords } = await query(
        `SELECT * FROM financials WHERE team_id = ? ORDER BY quarter_int, month_int`,
        [teamId]
    );

    // 2. Fetch allocations (RM Bids) for each quarter and month
    const { rows: rmBids } = await query(
        `SELECT quarter_id, month_id, bid_price_paise, allocated_volume FROM rm_bids WHERE team_id = ?`,
        [teamId]
    );

    // 3. Fetch Extra TMs
    const { rows: extraTms } = await query(
        `SELECT quarter_int, month_int, count FROM extra_tms WHERE team_id = ?`,
        [teamId]
    );

    // 4. Fetch Sales Volume (Total Allocated Customer Volume per Month)
    const { rows: customerSales } = await query(
        `SELECT quarter_id, month_id, SUM(allocated_volume) as total_vol 
         FROM customer_bids 
         WHERE team_id = ? 
         GROUP BY quarter_id, month_id`,
        [teamId]
    );

    // 5. Merge Data
    const history = financialRecords.map(rec => {
        const qId = rec.quarter_int;
        const mId = rec.month_int;

        // Find RM Bid for this Quarter and Month
        const rmBid = rmBids.find((r: any) => r.quarter_id === qId && r.month_id === mId);
        const rmCostPerM3 = rmBid ? rmBid.bid_price_paise : 0;

        // Find Sales Volume
        const sale = customerSales.find((s: any) => s.quarter_id === qId && s.month_id === mId);
        const salesVol = sale ? sale.total_vol : 0;

        // Find Extra TM
        const ext = extraTms.find((e: any) => e.quarter_int === qId && e.month_int === mId);
        const extraTmCount = ext ? ext.count : 0;

        // Calculate Totals Paid (Cash Outflow) for "Amount Paid" column
        // Sum of all costs + interest + expenses
        const amountPaidPaise = (rec.rm_cost_paise || 0) + (rec.tm_cost_paise || 0) + (rec.prod_cost_paise || 0) + (rec.expenses_paise || 0) + (rec.interest_paid_paise || 0);

        return {
            quarter: qId,
            month: mId,

            // Table 1 Data
            salesVolume: salesVol,
            revenuePaise: rec.revenue_paise,
            rmCostPaise: rec.rm_cost_paise,
            tmCostPaise: rec.tm_cost_paise,
            prodCostPaise: rec.prod_cost_paise,
            ebitdaPaise: rec.ebitda_paise,

            // Table 2 Data - Extra RM & TM
            extraRmVolume: rec.extra_rm_volume || 0,
            extraRmCostPerM3: rec.extra_rm_cost_per_m3_paise || 0,
            extraTmAdded: rec.extra_tm_count || 0,
            extraTmCostPerM3: rec.extra_tm_count > 0 ? (280000 * 100) : 0, // ₹280,000 per extra TM

            // Table 3 Data
            openingCashPaise: rec.cash_opening_paise,
            closingCashPaise: rec.cash_closing_paise,
            loanTakenPaise: 0, // Placeholder
            amountPaidPaise: amountPaidPaise,
            paymentReceivedPaise: (rec.revenue_paise || 0) - (rec.receivables_paise || 0) // Roughly Cash Inflow from Sales
        };
    });

    return history;
}

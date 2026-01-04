import { Server, Socket } from 'socket.io';
import * as QuarterController from '../../controllers/quarterController';
import * as LobbyController from '../../controllers/lobbyController';

export function handleGameEvents(io: Server, socket: Socket) {

    socket.on('submit_quarter_bid', async (data: {
        teamId: number,
        quarterId: number,
        bidPrice: number,
        bidVolume: number,
        tmCount: number
    }) => {
        try {
            await QuarterController.submitQuarterBid(
                data.teamId,
                data.quarterId,
                data.bidPrice * 100, // Client sends Rs, server stores Paise
                data.bidVolume,
                data.tmCount
            );

            socket.emit('bid_success', { message: "Bid Submitted" });

            // Notify Controller if everyone is ready?
            const allReady = await QuarterController.hasAllTeamsBid(data.quarterId);
            if (allReady) {
                io.emit('all_teams_bid_submitted');
            }
        } catch (err: any) {
            socket.emit('error_message', err.message || "Bid failed");
        }
    });

    socket.on('admin_process_allocations', async (data: { quarterId: number }) => {
        try {
            const results = await QuarterController.processQuarterAllocations(data.quarterId);

            // Advance to Month 1 of the Quarter (if currently 0, move to 1. If 1, stay 1?)
            // Usually this happens at Quarter Start.
            // Let's assume we are moving to Q1 M1 if currently Q0.
            await LobbyController.transitionToMonthStart(data.quarterId || 1, 1);

            io.emit('allocation_results', results);

            // Broadcast new state so clients know phase changed
            const newState = await LobbyController.getGameState();
            io.emit('game_state_update', newState);

            // CRITICAL: Broadcast updated teams so TM counts are fresh
            const updatedTeams = await LobbyController.getTeams();
            io.emit('teams_update', updatedTeams);

        } catch (err: any) {
            socket.emit('error_message', "Allocation failed");
        }
    });

    socket.on('get_allocations', async (data: { quarterId: number }) => {
        try {
            const results = await QuarterController.getQuarterAllocations(data.quarterId);
            socket.emit('allocation_results', results);
        } catch (err) {
            console.error(err);
        }
    });

    // --- Customer Auction Handlers ---

    socket.on('submit_customer_bids', async (data: {
        teamId: number,
        quarterId: number,
        bids: { customerId: string, askPrice: number, maxQty: number }[]
    }) => {
        try {
            // Validation: Total Volume cannot exceed monthly capacity (50,000)
            const totalVolume = data.bids.reduce((sum, b) => sum + (Number(b.maxQty) || 0), 0);
            if (totalVolume > 50000) {
                throw new Error(`Total bid volume (${totalVolume}) exceeds monthly capacity of 50,000 m³`);
            }

            // Process each bid
            // Ideally transactional but sequential is fine for now
            for (const bid of data.bids) {
                await QuarterController.submitCustomerBid(
                    data.teamId,
                    data.quarterId,
                    bid.customerId,
                    bid.askPrice * 100, // to Paise
                    bid.maxQty
                );
            }
            socket.emit('bid_success', { message: "Auction Bids Recorded" });
        } catch (err: any) {
            socket.emit('error_message', "Bid submission failed: " + err.message);
        }
    });

    socket.on('admin_process_customer_allocations', async (data: { quarterId: number }) => {
        try {
            await QuarterController.processCustomerAllocations(data.quarterId);

            // Fetch current month from DB to know which month's financials to calculate
            const gs = await LobbyController.getGameState();
            const currentMonth = gs.currentMonthWithinQuarter || 1;

            // --- NEW: Calculate Financials for Month X ---
            const { calculateMonthlyFinancials } = require('../../controllers/financialsController');
            await calculateMonthlyFinancials(data.quarterId, currentMonth);

            // Move to a RESULT phase
            await LobbyController.updateGamePhase('MONTH_END');

            const results = await QuarterController.getCustomerAllocations(data.quarterId);
            io.emit('customer_allocation_results', results);

            // Broadcast new state
            const newState = await LobbyController.getGameState();
            io.emit('game_state_update', newState);

        } catch (err: any) {
            console.error(err);
            socket.emit('error_message', "Customer Allocation failed");
        }
    });

    socket.on('get_customer_allocations', async (data: { quarterId: number }) => {
        try {
            const results = await QuarterController.getCustomerAllocations(data.quarterId);
            socket.emit('customer_allocation_results', results);
        } catch (err) {
            console.error(err);
        }
    });

    socket.on('get_my_financials', async (data: { teamId: number, quarterId: number }) => {
        try {
            const { getTeamFinancials } = require('../../controllers/financialsController');
            // Default to Month 1 if not implied, but better to get all or specific.
            // For dashboard, we might want current month or recently closed month.
            // Let's assume client wants the latest closed month? 
            // Actually, client usually knows what it wants. But for dashboard "Month 1 Financials" it was hardcoded.
            // If we are in M2 End, we want M2.
            const gs = await LobbyController.getGameState();
            // If phase is MONTH_END, we want the current month (just finished).
            // If phase is start of next, maybe previous?
            // For now, let's use currentMonthWithinQuarter.
            const targetMonth = gs.currentMonthWithinQuarter || 1;

            const fin = await getTeamFinancials(data.teamId, data.quarterId, targetMonth);
            socket.emit('my_financials', fin);
        } catch (err) {
            console.error(err);
        }
    });

    socket.on('get_cumulative_financials', async (data: { teamId: number, quarterId: number }) => {
        try {
            const { getCumulativeFinancials } = require('../../controllers/financialsController');
            const dataRes = await getCumulativeFinancials(data.teamId, data.quarterId);
            socket.emit('my_cumulative_financials', dataRes);
        } catch (err) {
            console.error(err);
        }
    });

    socket.on('get_customer_allocations', async (data: { quarterId: number }) => {
        try {
            const results = await QuarterController.getCustomerAllocations(data.quarterId);
            socket.emit('customer_allocation_results', results);
        } catch (err) {
            console.error(err);
        }
    });

    socket.on('get_all_month_financials', async (data: { quarterId: number, monthId: number }) => {
        console.log(`[Socket] get_all_month_financials requested for Q${data.quarterId} M${data.monthId}`);
        try {
            const { getAllTeamsFinancials, getAllTeamsCumulativeFinancials } = require('../../controllers/financialsController');

            // 1. Monthly Data
            const results = await getAllTeamsFinancials(data.quarterId, data.monthId);
            socket.emit('all_month_financials_results', results);

            // 2. Cumulative Data (Leaderboard)
            const leaderboard = await getAllTeamsCumulativeFinancials(data.quarterId);
            socket.emit('leaderboard_results', leaderboard);

            console.log(`[Socket] Sent ${results.length} monthly records and ${leaderboard.length} leaderboard records.`);
        } catch (err: any) {
            console.error("[Socket] Error fetching financials:", err);
            socket.emit('error_message', "Failed to fetch month financials");
        }
    });

    // --- Month End / Next Month Handlers ---

    socket.on('admin_recalculate_financials', async (data: { quarterId: number }) => {
        try {
            // Force recalculation for Current Month
            const gs = await LobbyController.getGameState();
            const currentMonth = gs.currentMonthWithinQuarter || 1;

            const { calculateMonthlyFinancials } = require('../../controllers/financialsController');
            await calculateMonthlyFinancials(data.quarterId, currentMonth);

            // Notify teams to refresh
            io.emit('financials_updated');
        } catch (err: any) {
            socket.emit('error_message', "Recalculation failed: " + err.message);
        }
    });

    socket.on('admin_advance_month', async (data: { quarterId: number }) => {
        try {
            const gs = await LobbyController.getGameState();
            const currentMonth = gs.currentMonthWithinQuarter || 1;
            const currentQuarter = gs.currentQuarter || 1;

            let nextMonth = currentMonth + 1;
            let nextQuarter = currentQuarter;
            let nextPhase = 'CUSTOMER_AUCTION_PREROLL'; // Default flow same quarter

            if (nextMonth > 3) {
                console.log(`[Admin] Quarter ${currentQuarter} Ended. Transitioning to Quarter ${currentQuarter + 1}`);

                // --- 1. END OF QUARTER LOGIC (Liquidation) ---
                const { liquidateRemainingRM } = require('../../controllers/financialsController');
                await liquidateRemainingRM(currentQuarter);

                // --- 2. START NEW QUARTER ---
                nextMonth = 1;
                nextQuarter = currentQuarter + 1;
                nextPhase = 'LOBBY'; // Reset to LOBBY for RM Bidding
            }

            console.log(`[Admin] Advancing to Q${nextQuarter} M${nextMonth} | Phase: ${nextPhase}`);

            await query(
                `UPDATE game_state SET current_quarter = ?, current_month_within_quarter = ?, phase = ? WHERE id=1`,
                [nextQuarter, nextMonth, nextPhase]
            );

            // If new quarter, we might want to clear old bids or just rely on QID separation?
            // Tables (rm_bids, etc) use quarter_id, so strict separation exists.

            const newState = await LobbyController.getGameState();
            io.emit('game_state_update', newState);
        } catch (err: any) {
            console.error(err);
            socket.emit('error_message', "Advance Month failed: " + err.message);
        }
    });
    socket.on('admin_end_game', async (password: string) => {
        if (password !== 'admin123') return; // Basic Auth
        try {
            console.log('[Admin] Ending Game');
            await query(`UPDATE game_state SET phase = 'GAME_OVER' WHERE id=1`);
            const newState = await LobbyController.getGameState();
            io.emit('game_state_update', newState);
        } catch (err: any) {
            socket.emit('error_message', "Failed to end game: " + err.message);
        }
    });
}

const { query } = require('../../db'); // Import query helper locally if needed or use existing


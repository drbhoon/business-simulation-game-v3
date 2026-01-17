import { Server, Socket } from 'socket.io';
import * as QuarterController from '../../controllers/quarterController';
import * as LobbyController from '../../controllers/lobbyController';

export function handleGameEvents(io: Server, socket: Socket) {

    // Helper to broadcast status
    const broadcastTeamStatus = async (quarterId: number) => {
        try {
            const statusMap = await QuarterController.getTeamSubmissionStatus(quarterId);
            io.emit('team_status_update', statusMap);
        } catch (err) {
            console.error("Failed to broadcast team status:", err);
        }
    };

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
            broadcastTeamStatus(data.quarterId); // Broadcast update

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
            // GUARD: Check Phase first
            const currentState = await LobbyController.getGameState();
            if (currentState.phase !== 'QUARTER_START') {
                // Allow re-run if already in MONTH_START? No, that causes reset issues.
                // Strictly enforce QUARTER_START.
                throw new Error("Action blocked: Allocation phase (QUARTER_START) is required.");
            }

            const results = await QuarterController.processQuarterAllocations(data.quarterId);

            // FIX: Get current month from DB so we don't reset to 1 if we are in M2/M3
            const currentMonth = currentState.currentMonthWithinQuarter || 1;

            await LobbyController.transitionToMonthStart(data.quarterId || 1, currentMonth);

            io.emit('allocation_results', results);

            // Broadcast new state so clients know phase changed
            const newState = await LobbyController.getGameState();
            io.emit('game_state_update', newState);

            // CRITICAL: Broadcast updated teams so TM counts are fresh
            const updatedTeams = await LobbyController.getTeams();
            io.emit('teams_update', updatedTeams);

            broadcastTeamStatus(data.quarterId); // Broadcast update (resets for next phase if month changed logic was tricky, but status checks DB)

        } catch (err: any) {
            socket.emit('error_message', "Allocation failed");
        }
    });

    // ... inside admin_set_phase or others?
    // Let's also add it to get_initial_state or request
    socket.on('get_team_status', async (data: { quarterId: number }) => {
        await broadcastTeamStatus(data.quarterId);
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
            broadcastTeamStatus(data.quarterId); // Broadcast update
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
            socket.emit('error_message', "Customer Allocation failed: " + err.message);
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

            // FIX: Also send results to Controller immediately
            const { getAllTeamsFinancials, getAllTeamsCumulativeFinancials } = require('../../controllers/financialsController');
            const results = await getAllTeamsFinancials(data.quarterId, currentMonth);
            const leaderboard = await getAllTeamsCumulativeFinancials(data.quarterId);

            socket.emit('all_month_financials_results', results);
            socket.emit('leaderboard_results', leaderboard);

        } catch (err: any) {
            socket.emit('error_message', "Recalculation failed: " + err.message);
        }
    });

    socket.on('admin_advance_month', async (data: { quarterId: number }) => {
        try {
            const gs = await LobbyController.getGameState();
            const currentMonth = gs.currentMonthWithinQuarter || 1;
            const currentQuarter = gs.currentQuarter || 1;

            console.log(`[Admin] BEFORE ADVANCE: Q${currentQuarter} M${currentMonth} | Phase: ${gs.phase}`);

            let nextMonth = currentMonth + 1;
            let nextQuarter = currentQuarter;
            // V3: Monthly RM/TM Bidding - Always go back to LOBBY for new month bidding
            let nextPhase = 'LOBBY';

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

            console.log(`[Admin] ADVANCING TO: Q${nextQuarter} M${nextMonth} | Phase: ${nextPhase}`);

            await query(
                `UPDATE game_state SET current_quarter = ?, current_month_within_quarter = ?, phase = ? WHERE id=1`,
                [nextQuarter, nextMonth, nextPhase]
            );

            // Verify the update
            const verifyState = await LobbyController.getGameState();
            console.log(`[Admin] AFTER UPDATE: Q${verifyState.currentQuarter} M${verifyState.currentMonthWithinQuarter} | Phase: ${verifyState.phase}`);

            // FIX: Broadcast new state to ALL clients
            io.emit('game_state_update', verifyState);

            // If new quarter, we might want to clear old bids or just rely on QID separation?
            // Tables (rm_bids, etc) use quarter_id, so strict separation exists.

            const newState = await LobbyController.getGameState();
            io.emit('game_state_update', newState);
            console.log(`[Admin] Emitted game_state_update:`, newState);
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
    socket.on('get_team_history', async (data: { teamId: number }) => {
        try {
            const { getTeamCompleteHistory } = require('../../controllers/financialsController');
            const history = await getTeamCompleteHistory(data.teamId);
            socket.emit('team_history_results', history);
        } catch (err: any) {
            console.error(err);
        }
    });

}

const { query } = require('../../db'); // Import query helper locally if needed or use existing



import { query } from '../db';
import { liquidateRemainingRM } from '../controllers/financialsController';

async function fixTransition() {
    console.log("Checking Game State...");
    const { rows } = await query("SELECT * FROM game_state WHERE id = 1");
    const gs = rows[0];

    console.log("Current State:", gs);

    if (gs.current_quarter === 1 && gs.current_month_within_quarter >= 4) {
        console.log("DETECTED STUCK STATE: Q1 M4. Fixing...");

        // 1. Liquidate Q1
        console.log("Liquidating Q1 RM...");
        await liquidateRemainingRM(1);

        // 2. Force Move to Q2 M1 LOBBY
        console.log("Updating Game State to Q2 M1 LOBBY...");
        await query(
            `UPDATE game_state 
             SET current_quarter = 2, 
                 current_month_within_quarter = 1, 
                 phase = 'LOBBY' 
             WHERE id = 1`
        );

        console.log("Fix Complete.");
    } else {
        console.log("State does not need fixing or is unexpected. No action taken.");
    }
    process.exit(0);
}

fixTransition();

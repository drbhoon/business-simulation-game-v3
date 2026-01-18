
import { getAllTeamsCumulativeFinancials } from '../controllers/financialsController';

async function test() {
    console.log("Testing Leaderboard Query for Quarter 1...");
    try {
        const results = await getAllTeamsCumulativeFinancials(1);
        console.log("Results:", JSON.stringify(results, null, 2));
    } catch (err) {
        console.error("Error:", err);
    }
}

test();

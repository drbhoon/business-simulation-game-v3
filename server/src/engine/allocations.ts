import { CONSTANTS, RMBid } from './types';

interface AllocationResult {
    teamId: number;
    bidPricePaise: number;
    bidVolume: number;
    rank: number;
    allocatedVolume: number;
    allocationFactor: number;
}

export function calculateRMAllocations(bids: RMBid[]): AllocationResult[] {
    // 1. Sort by Price DESC. Tie-breaker: Time (not tracked here yet, maybe ID or random? Requirements say stable tie - breaker. Let's use Team ID for stability if price equal)
    const sortedBids = [...bids].sort((a, b) => {
        if (b.bidPricePaise !== a.bidPricePaise) {
            return b.bidPricePaise - a.bidPricePaise;
        }
        return a.teamId - b.teamId; // Lower ID wins tie (stable)
    });

    const results: AllocationResult[] = [];
    const factors = CONSTANTS.RANK_ALLOCATION_RM; // [1.0, 0.9, 0.8, 0.7, 0.4]

    sortedBids.forEach((bid, index) => {
        // If more bids than factors, use the last factor or 0? 
        // Spec says: "Allocations by bid ranking: Highest 100%, Next 90%... Lowest 40%". 
        // Implies for 5 teams. If fewer teams, we just take top N factors? 
        // "If fewer than 5 teams bid..." isn't explicitly defined for RM, only for Auction. 
        // But logical assumption: Rank 1 gets factor[0], Rank 2 gets factor[1], etc.

        // Handle case where index >= factors.length (unlikely with max 5 teams, but good for safety)
        const factor = index < factors.length ? factors[index] : factors[factors.length - 1];

        const allocated = Math.floor(bid.bidVolume * factor);

        results.push({
            teamId: bid.teamId,
            bidPricePaise: bid.bidPricePaise,
            bidVolume: bid.bidVolume,
            rank: index + 1,
            allocatedVolume: allocated,
            allocationFactor: factor
        });
    });

    return results;
}

export function calculateCustomerAllocations(bids: { teamId: number, askPricePaise: number, askQty: number }[], customerDemand: number): { teamId: number, rank: number, allocatedVolume: number }[] {
    // 1. Sort by Price ASC (Lowest price wins). Tie-breaker: Team ID
    const sortedBids = [...bids].sort((a, b) => {
        if (a.askPricePaise !== b.askPricePaise) {
            return a.askPricePaise - b.askPricePaise;
        }
        return a.teamId - b.teamId;
    });

    const results: { teamId: number, rank: number, allocatedVolume: number }[] = [];

    // User Logic: Fill demand starting from lowest bidder.
    // If Bid Vol < Remaining Demand -> Give Full Bid Vol
    // If Bid Vol >= Remaining Demand -> Give Remaining Demand (Partial)
    // If Remaining Demand is 0 -> Give 0

    let remainingDemand = customerDemand;

    sortedBids.forEach((bid, index) => {
        let allocated = 0;

        if (remainingDemand > 0) {
            if (bid.askQty <= remainingDemand) {
                // Can fill completely
                allocated = bid.askQty;
                remainingDemand -= bid.askQty;
            } else {
                // Must fill partially
                allocated = remainingDemand;
                remainingDemand = 0;
            }
        } else {
            // No demand left for higher priced bids
            allocated = 0;
        }

        results.push({
            teamId: bid.teamId,
            rank: index + 1,
            allocatedVolume: allocated
        });
    });

    return results;
}

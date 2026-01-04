export interface Team {
    id: number;
    name: string;
    pinCode: string;
    baseTmCount: number;
}

export type GamePhase = 'LOBBY' | 'QUARTER_PREROLL' | 'QUARTER_START' | 'RM_BIDDING' | 'MONTH_START' | 'CUSTOMER_AUCTION_PREROLL' | 'CUSTOMER_AUCTION' | 'MONTH_END' | 'QUARTER_END' | 'GAME_OVER';

export interface GameState {
    id: number;
    currentQuarter: number;
    currentMonthWithinQuarter: number; // 1, 2, 3
    phase: GamePhase;
    marketSizeCurrentMonth: number;
    isPaused: boolean;
}

export interface RMBid {
    teamId: number;
    bidPricePaise: number;
    bidVolume: number; // m3
}

export interface AuctionBid {
    teamId: number;
    customerId: string; // 'LADDU' | ...
    askPricePaise: number;
    askQty: number;
}

export interface Customer {
    id: string; // 'LADDU', 'SHAHI', 'LEMON', 'JAMOON'
    name: string;
    sharePct: number; // 0.4, 0.3, ...
    payTermDays: number; // 60, 30, 0
}

export const CUSTOMERS: Customer[] = [
    { id: 'LADDU', name: 'Laddu', sharePct: 0.4, payTermDays: 60 },
    { id: 'SHAHI', name: 'Shahi-Poori Ji', sharePct: 0.3, payTermDays: 30 },
    { id: 'LEMON', name: 'Lemon & Tea', sharePct: 0.2, payTermDays: 0 },
    { id: 'JAMOON', name: 'Jamoon', sharePct: 0.1, payTermDays: 0 },
];

export const CONSTANTS = {
    MAX_TEAMS: 5,
    MIN_TEAMS: 2,
    MAX_QUARTERS: 4,
    MONTHS_PER_QUARTER: 3,

    PRICE_CAP_PAISE: 7000 * 100,
    MIN_BID_PRICE_PAISE: 2500 * 100,

    PRODUCTION_CAP_M3: 50000,
    TM_CAPACITY_M3_MONTH: 540, // 30 days * 3 trips * 6 m3

    BASE_TM_COST_PAISE: 180000 * 100,
    EXTRA_TM_COST_PAISE: 250000 * 100,

    SEED_WC_PAISE: 100000000 * 100, // 10 Cr
    LOAN_LIMIT_PAISE: 200000000 * 100, // 20 Cr total (10 seed + 10 loan)
    INTEREST_RATE_MONTHLY: 0.02,

    RANK_ALLOCATION_RM: [1.0, 0.9, 0.8, 0.7, 0.4], // 100%, 90%...
    RANK_ALLOCATION_AUCTION: [0.33333, 0.26667, 0.20000, 0.13333, 0.06667],

    COST_TIERS: [
        { minVol: 40000, rate: 300 * 100 },
        { minVol: 30000, rate: 400 * 100 },
        { minVol: 20000, rate: 500 * 100 },
        { minVol: 10000, rate: 600 * 100 },
        { minVol: 0, rate: 700 * 100 },
    ]
};

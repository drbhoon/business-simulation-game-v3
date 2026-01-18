import React, { useEffect, useState } from 'react';
import { useSocket } from '../contexts/SocketContext';

interface TeamDashboardProps {
    team: { id: number; name: string; baseTmCount: number };
    gameState: { phase: string; currentQuarter: number; currentMonthWithinQuarter?: number };
}

const TeamDashboard: React.FC<TeamDashboardProps> = ({ team, gameState }) => {
    const socket = useSocket();

    // --- STATE HOOKS (Must be at top level) ---

    // 1. Quarter Start Inputs
    // Using string to allow empty inputs avoiding '0' prefix issues
    const [bidPrice, setBidPrice] = useState('');
    const [bidVolume, setBidVolume] = useState('');
    const [tmCount, setTmCount] = useState('');
    const [isBidSubmitted, setIsBidSubmitted] = useState(false);
    const [statusMsg, setStatusMsg] = useState('');
    const [isAuctionBidSubmitted, setIsAuctionBidSubmitted] = useState(false);

    // 2. Customer Auction State
    const [customerBids, setCustomerBids] = useState<Record<string, { price: number, qty: number }>>({});
    const CUSTOMERS = ['LADDU', 'SHAHI', 'LEMON', 'JAMOON'];

    // 3. Allocation State
    const [myAllocation, setMyAllocation] = useState<{ rm: number; rank: number } | null>(null);

    // 4. Financials State (Hoisted from Month End)
    const [financials, setFinancials] = useState<any>(null);
    const [customerWins, setCustomerWins] = useState<any[]>([]);

    // 5. Persistent Stats State
    const [cumulativeStats, setCumulativeStats] = useState<{
        quarterEbitdaPaise: number,
        totalGameEbitdaPaise: number,
        closingCashPaise: number
    } | null>(null);

    // 6. Full History State
    const [history, setHistory] = useState<any[] | null>(null);
    // 7. Leaderboard State
    const [leaderboardData, setLeaderboardData] = useState<any[]>([]);

    // --- EFFECTS ---

    // Bid socket listeners
    useEffect(() => {
        if (!socket) return;
        socket.on('bid_success', (data: any) => {
            setStatusMsg(data.message);
            if (gameState.phase === 'CUSTOMER_AUCTION') {
                setIsAuctionBidSubmitted(true);
            } else {
                setIsBidSubmitted(true);
            }
        });
        socket.on('error_message', (msg: string) => setStatusMsg('Error: ' + msg));
        // History listener
        socket.on('team_history_results', (data: any[]) => {
            setHistory(data);
        });
        // Leaderboard listener
        socket.on('leaderboard_results', (data: any[]) => {
            setLeaderboardData(data);
        });

        return () => {
            socket.off('bid_success');
            socket.off('error_message');
            socket.off('team_history_results');
            socket.off('leaderboard_results');
        };
    }, [socket]);

    // Polling for History
    useEffect(() => {
        if (!socket || !team.id) return;
        const fetchHistory = () => {
            socket.emit('get_team_history', { teamId: team.id });
        };
        fetchHistory(); // Initial fetch
        const interval = setInterval(fetchHistory, 10000); // Poll every 10s
        return () => clearInterval(interval);
    }, [socket, team.id, gameState.currentMonthWithinQuarter]); // Update when month changes

    // Allocation listeners
    useEffect(() => {
        if (!socket) return;
        socket.on('allocation_results', (results: any[]) => {
            const mine = results.find((r: any) => r.teamId === team.id);
            if (mine) setMyAllocation({ rm: mine.allocatedVolume, rank: mine.rank });
        });
        return () => { socket.off('allocation_results'); };
    }, [socket, team.id]);

    // Financials listeners (Persistent)
    useEffect(() => {
        if (!socket) return;
        // Don't fetch in Lobby/Preroll
        if (gameState.phase === 'LOBBY' || gameState.phase === 'QUARTER_PREROLL') return;

        const fetchM1 = () => {
            socket.emit('get_my_financials', { teamId: team.id, quarterId: gameState.currentQuarter || 1 });
            socket.emit('get_customer_allocations', { quarterId: gameState.currentQuarter || 1 });
        };
        fetchM1();

        socket.on('my_financials', (data) => setFinancials(data));
        socket.on('financials_updated', fetchM1);
        socket.on('customer_allocation_results', (data: any[]) => {
            const myWins = data.filter(r => r.teamId === team.id && r.allocatedVolume > 0);
            setCustomerWins(myWins);
        });

        return () => {
            socket.off('my_financials');
            socket.off('financials_updated');
            socket.off('customer_allocation_results');
        };
    }, [socket, team.id, gameState.phase, gameState.currentQuarter, gameState.currentMonthWithinQuarter]);

    // Persistent Stats Polling
    useEffect(() => {
        if (!socket || !team.id) return;
        const fetchStats = () => {
            socket.emit('get_cumulative_financials', { teamId: team.id, quarterId: gameState.currentQuarter || 1 });
            // Fetch Leaderboard (Valid in all phases)
            socket.emit('get_leaderboard', { quarterId: gameState.currentQuarter || 1 });
        };
        fetchStats();
        const interval = setInterval(fetchStats, 5000);
        socket.on('my_cumulative_financials', (data) => setCumulativeStats(data));
        // Also listen for updates
        socket.on('financials_updated', fetchStats);
        return () => {
            clearInterval(interval);
            socket.off('my_cumulative_financials');
            socket.off('financials_updated', fetchStats);
        };
    }, [socket, team.id, gameState.currentQuarter]);

    // RESET STATE ON PHASE CHANGE
    useEffect(() => {
        setStatusMsg('');
        setIsBidSubmitted(false);
        setIsAuctionBidSubmitted(false);
        // Optional: Reset form values if desired
        // setBidPrice(3000);
        // setBidVolume(10000);
        // setTmCount(0);
        // setCustomerBids({});
    }, [gameState.phase, gameState.currentQuarter]);


    // --- HANDLERS ---
    const handleCustomerBidChange = (custId: string, field: 'price' | 'qty', val: number) => {
        setCustomerBids(prev => ({
            ...prev,
            [custId]: { ...prev[custId], [field]: val }
        }));
    };

    const submitAuctionBids = () => {
        if (!socket) return;
        const bidsArray = Object.entries(customerBids).map(([custId, data]) => ({
            customerId: custId, askPrice: data.price, maxQty: data.qty
        }));
        if (bidsArray.length === 0) { setStatusMsg("Please enter at least one bid."); return; }

        socket.emit('submit_customer_bids', {
            teamId: team.id,
            quarterId: Math.max(gameState.currentQuarter, 1),
            bids: bidsArray
        });
    };

    const submitBid = () => {
        if (!socket) return;
        socket.emit('submit_quarter_bid', {
            teamId: team.id,
            quarterId: Math.max(gameState.currentQuarter, 1),
            bidPrice: Number(bidPrice) || 0,
            bidVolume: Number(bidVolume) || 0,
            tmCount: Number(tmCount) || 0
        });
    };


    // --- RENDER CONTENT ---
    const renderPhaseContent = () => {
        if (gameState.phase === 'LOBBY') {
            const currentQ = gameState.currentQuarter || 1;
            const currentM = gameState.currentMonthWithinQuarter || 1;

            if (currentQ > 1 || currentM > 1) {
                // Mid-game LOBBY (monthly RM/TM bidding)
                return (
                    <div className="p-10 text-center text-white bg-gray-800 rounded-lg max-w-2xl mx-auto mt-10 shadow-lg border border-blue-500/30">
                        <h1 className="text-4xl font-black text-blue-400 mb-4 animate-pulse">QUARTER {currentQ}, MONTH {currentM}</h1>
                        <p className="text-xl text-gray-300">Waiting for RM & TM Bidding to Start...</p>
                        <p className="text-sm text-gray-500 mt-2">Admin will open bidding shortly</p>
                    </div>
                );
            }
            // For Q1 M1 Lobby, we usually don't reach here due to Lobby.tsx logic, but if we do:
            return (
                <div className="p-4 bg-gray-900 text-white min-h-screen">
                    <GameRulesInfo teamName={team.name} />
                </div>
            );
        }

        if (gameState.phase === 'QUARTER_START') {
            return (
                <div className="p-6 bg-gray-800 text-white rounded-lg shadow-xl max-w-2xl mx-auto mt-10 font-sans">
                    <div className="flex justify-center mb-6">
                        <img src="/rdc_logo.png" alt="RDC Logo" className="h-20 object-contain" />
                    </div>
                    <h2 className="text-3xl font-bold mb-6 text-blue-400 text-center">
                        Q{Math.max(gameState.currentQuarter, 1)} M{gameState.currentMonthWithinQuarter || 1} Planning
                    </h2>
                    <div className="space-y-6">
                        <div className="bg-gray-700 p-4 rounded">
                            <label className="block text-sm font-bold mb-2">Raw Material Bid Price (₹/m³)</label>
                            <input
                                type="number"
                                className="w-full p-2 text-black rounded"
                                value={bidPrice}
                                min={2500}
                                max={5000}
                                placeholder="Min 2500"
                                onChange={(e) => setBidPrice(e.target.value)}
                                disabled={isBidSubmitted}
                            />
                            <p className="text-xs text-gray-400 mt-1">Min: ₹2,500 | Max: ₹5,000</p>
                        </div>
                        <div className="bg-gray-700 p-4 rounded">
                            <label className="block text-sm font-bold mb-2">Raw Material Volume (m³)</label>
                            <input
                                type="number"
                                className="w-full p-2 text-black rounded"
                                value={bidVolume}
                                placeholder="Max 50000"
                                onChange={(e) => setBidVolume(e.target.value)}
                                disabled={isBidSubmitted}
                            />
                            <p className="text-xs text-gray-400 mt-1">Max Capacity: 50,000 m³ per month</p>
                        </div>
                        <div className="bg-gray-700 p-4 rounded">
                            <label className="block text-sm font-bold mb-2">Transit Mixer Order (Count)</label>
                            <input
                                type="number"
                                className="w-full p-2 text-black rounded"
                                value={tmCount}
                                placeholder="0"
                                onChange={(e) => setTmCount(e.target.value)}
                                disabled={isBidSubmitted}
                            />
                            <p className="text-xs text-gray-400 mt-1">Cost: ₹1,80,000 per TM/month</p>
                        </div>
                        <button onClick={submitBid} disabled={isBidSubmitted} className={`w-full py-3 font-bold rounded transition ${isBidSubmitted ? 'bg-green-600 cursor-default' : 'bg-blue-600 hover:bg-blue-500'}`}>
                            {isBidSubmitted ? 'Bid Submitted' : 'Submit Plan'}
                        </button>
                        {statusMsg && <p className="text-center font-semibold mt-4">{statusMsg}</p>}
                    </div>
                </div>
            );
        }

        if (gameState.phase === 'MONTH_START') {
            return (
                <div className="p-10 text-center text-white bg-gray-800 rounded-lg max-w-2xl mx-auto mt-10 shadow-lg border border-yellow-500/30">
                    <h1 className="text-3xl font-bold text-yellow-400 mb-6">Allocation Results</h1>
                    <div className="bg-gray-700/50 p-6 rounded-lg mb-8 space-y-4">
                        <div className="grid grid-cols-2 gap-4 text-left">
                            <div className="bg-gray-800 p-4 rounded border border-gray-600">
                                <span className="block text-gray-400 text-sm">RM Allocation</span>
                                <span className="text-2xl font-bold text-green-400">{myAllocation ? myAllocation.rm.toLocaleString() : '...'} m³</span>
                            </div>
                            <div className="bg-gray-800 p-4 rounded border border-gray-600">
                                <span className="block text-gray-400 text-sm">TM Allocation</span>
                                <span className="text-2xl font-bold text-blue-400">{team.baseTmCount} Units</span>
                            </div>
                        </div>
                    </div>
                    <div className="animate-pulse">
                        <p className="text-xl text-gray-200 font-semibold">Your Allocation: RM {myAllocation ? myAllocation.rm.toLocaleString() : '...'} | TM {team.baseTmCount}</p>
                        <p className="text-lg text-yellow-500 mt-2">Wait for Customer Auction...</p>
                    </div>
                </div>
            );
        }

        if (gameState.phase === 'CUSTOMER_AUCTION_PREROLL') {
            return (
                <div className="min-h-[50vh] flex items-center justify-center p-8">
                    <div className="text-center space-y-6 animate-pulse">
                        <h1 className="text-5xl font-black text-pink-500">GET READY!</h1>
                        <p className="text-3xl text-gray-200 font-bold">Customer Volume Auction</p>
                        <p className="text-xl text-gray-400">Prepare your bids...</p>
                    </div>
                </div>
            );
        }

        if (gameState.phase === 'CUSTOMER_AUCTION') {
            return (
                <div className="p-6 bg-gray-800 text-white rounded-lg shadow-xl max-w-4xl mx-auto mt-10">
                    <h1 className="text-3xl font-bold mb-6 text-pink-400">Customer Volume Auction</h1>
                    <p className="text-gray-400 mb-6">Submit your Ask Price (₹/m³) and Max Volume for each customer.</p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {CUSTOMERS.map((custId) => (
                            <div key={custId} className="bg-gray-700 p-4 rounded border border-gray-600">
                                <h3 className="font-bold text-lg text-white mb-2">{custId}</h3>
                                <div className="space-y-3">
                                    <div className="flex gap-2">
                                        <input type="number" className="w-1/2 p-2 rounded text-black font-bold" placeholder="Price" onChange={(e) => handleCustomerBidChange(custId, 'price', Number(e.target.value))} />
                                        <input type="number" className="w-1/2 p-2 rounded text-black font-bold" placeholder="Vol" onChange={(e) => handleCustomerBidChange(custId, 'qty', Number(e.target.value))} />
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                    <div className="mt-8 text-center">
                        <button
                            onClick={submitAuctionBids}
                            disabled={isAuctionBidSubmitted}
                            className={`font-bold py-3 px-10 rounded shadow-lg text-lg transform transition ${isAuctionBidSubmitted ? 'bg-green-600 text-white cursor-default' : 'bg-pink-600 hover:bg-pink-500 text-white active:scale-95'}`}
                        >
                            {isAuctionBidSubmitted ? "Bids Submitted" : "Submit Auction Bids"}
                        </button>
                        {statusMsg && !isAuctionBidSubmitted && <p className="text-red-400 mt-4 font-bold">{statusMsg}</p>}
                        {isAuctionBidSubmitted && <p className="text-green-400 mt-4 font-bold animate-bounce">Bids Recorded Successfully!</p>}
                    </div>
                </div>
            );
        }

        if (gameState.phase === 'GAME_OVER') {
            return (
                <div className="p-8 max-w-4xl mx-auto text-white text-center">
                    <h1 className="text-6xl font-black text-transparent bg-clip-text bg-gradient-to-r from-yellow-400 to-yellow-600 mb-8 animate-pulse">
                        GAME OVER
                    </h1>
                    <div className="bg-gray-800 rounded-xl p-8 shadow-2xl border border-yellow-600/50">
                        <p className="text-2xl text-gray-300 mb-6">Thank you for playing!</p>
                        <p className="text-lg text-gray-400">Please check the main screen for final standings.</p>
                        {cumulativeStats && (
                            <div className="mt-8 p-6 bg-gray-700/50 rounded-lg">
                                <h3 className="text-xl text-yellow-500 font-bold mb-4">Your Final Performance</h3>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <span className="block text-gray-400 text-sm">Total EBITDA</span>
                                        <span className={`text-2xl font-bold ${cumulativeStats.totalGameEbitdaPaise >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                            ₹{(cumulativeStats.totalGameEbitdaPaise / 100).toLocaleString()}
                                        </span>
                                    </div>
                                    <div>
                                        <span className="block text-gray-400 text-sm">Final Cash</span>
                                        <span className="text-2xl font-bold text-white">
                                            ₹{(cumulativeStats.closingCashPaise / 100).toLocaleString()}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            );
        }

        if (gameState.phase === 'MONTH_END') {
            return (
                <div className="p-8 max-w-6xl mx-auto text-white">
                    <h1 className="text-4xl font-bold text-center mb-8 text-green-400">
                        Month {gameState.currentMonthWithinQuarter || 1}, Q{gameState.currentQuarter} Results
                    </h1>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        {/* 1. Financial Card */}
                        <div className="bg-gray-800 rounded-lg p-6 shadow-xl border border-gray-700">
                            <h2 className="text-xl font-bold mb-4 text-yellow-500">Financial Performance</h2>
                            {!financials ? <p className="animate-pulse">Loading Financials...</p> : (
                                <div className="space-y-4">
                                    <div className="flex justify-between border-b border-gray-700 pb-2">
                                        <span className="text-gray-400">Revenue</span>
                                        <span className="text-xl font-bold text-green-400">₹{(financials.revenue_paise / 100).toLocaleString()}</span>
                                    </div>
                                    <div className="flex justify-between border-b border-gray-700 pb-2">
                                        <span className="text-gray-400">EBITDA</span>
                                        <span className={`text-xl font-bold ${financials.ebitda_paise >= 0 ? 'text-blue-400' : 'text-red-400'}`}>
                                            ₹{(financials.ebitda_paise / 100).toLocaleString()}
                                        </span>
                                    </div>
                                    <div className="flex justify-between pt-2">
                                        <span className="text-gray-400">Closing Cash</span>
                                        <span className="text-2xl font-bold text-white">₹{(financials.cash_closing_paise / 100).toLocaleString()}</span>
                                    </div>
                                    {financials.receivables_paise > 0 && (
                                        <div className="mt-4 p-3 bg-blue-900/30 rounded border border-blue-500/30 text-sm">
                                            <span className="block text-blue-200">Pending Receivables</span>
                                            <span className="font-bold text-lg">₹{(financials.receivables_paise / 100).toLocaleString()}</span>
                                        </div>
                                    )}

                                    {/* OPERATIONAL STATS */}
                                    <div className="mt-6 pt-4 border-t border-gray-700 grid grid-cols-2 gap-4">
                                        <div className="text-center p-2 bg-gray-700/30 rounded">
                                            <span className="block text-gray-400 text-xs uppercase">RM Balance</span>
                                            <span className={`text-lg font-bold ${(financials.rm_closing_balance || 0) < 0 ? 'text-red-400' : 'text-blue-300'}`}>
                                                {(financials.rm_closing_balance || 0).toLocaleString()} m³
                                            </span>
                                        </div>
                                        <div className="text-center p-2 bg-gray-700/30 rounded">
                                            <span className="block text-gray-400 text-xs uppercase">Fleet Size</span>
                                            <span className="text-lg font-bold text-blue-300">
                                                {financials.tm_count_current || 0} TMs
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* 2. Customer Wins */}
                        <div className="bg-gray-800 rounded-lg p-6 shadow-xl border border-gray-700">
                            <h2 className="text-xl font-bold mb-4 text-pink-500">Customer Allocation</h2>
                            {customerWins.length === 0 ? <p className="text-gray-500 italic">No customers won this month.</p> : (
                                <table className="w-full text-left text-sm">
                                    <thead className="text-xs uppercase bg-gray-700/50 text-gray-400">
                                        <tr>
                                            <th className="p-2">Customer</th> <th className="p-2 text-right">Vol</th> <th className="p-2 text-right">Price</th> <th className="p-2 text-right">Rev</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-700">
                                        {customerWins.map((w, i) => (
                                            <tr key={i}>
                                                <td className="p-2 font-bold text-pink-300">{w.customerId}</td>
                                                <td className="p-2 text-right text-white">{w.allocatedVolume.toLocaleString()}</td>
                                                <td className="p-2 text-right text-gray-400">₹{w.bidPricePaise / 100}</td>
                                                <td className="p-2 text-right text-green-400 font-bold">₹{((w.allocatedVolume * w.bidPricePaise) / 100).toLocaleString()}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}
                        </div>
                    </div>
                    <div className="mt-10 text-center text-gray-500">Waiting for Admin to start Month {(gameState.currentMonthWithinQuarter || 1) + 1}...</div>
                </div>
            );
        }

        return (
            <div className="p-10 text-center text-white bg-gray-800 rounded">
                <h2 className="text-2xl">Phase: {gameState.phase}</h2>
                <p className="text-gray-400">Waiting for next steps...</p>
            </div>
        );
    };

    const FinancialsSidebar = () => {
        if (!financials) return (
            <div className="bg-gray-800 p-4 rounded text-center text-gray-500 text-sm">
                No financial data available yet.
            </div>
        );

        return (
            <div className="bg-gray-800 rounded-lg p-6 shadow-xl border border-gray-700 h-fit sticky top-6">
                <h3 className="text-lg font-bold mb-4 text-yellow-500 uppercase tracking-wider border-b border-gray-700 pb-2">
                    Month {gameState.currentMonthWithinQuarter || 1}, Q{gameState.currentQuarter} Financials
                </h3>
                <div className="space-y-4 text-sm">
                    <div className="flex justify-between">
                        <span className="text-gray-400">Revenue</span>
                        <span className="font-bold text-green-400">₹{(financials.revenue_paise / 100).toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between">
                        <span className="text-gray-400">EBITDA</span>
                        <span className={`font-bold ${financials.ebitda_paise >= 0 ? 'text-blue-400' : 'text-red-400'}`}>
                            ₹{(financials.ebitda_paise / 100).toLocaleString()}
                        </span>
                    </div>
                    <div className="pt-2 border-t border-gray-700 mt-2">
                        <div className="flex justify-between">
                            <span className="text-gray-400">Cash Flow</span>
                        </div>
                        <div className="text-2xl font-bold text-white mt-1">
                            ₹{(financials.cash_closing_paise / 100).toLocaleString()}
                        </div>
                    </div>
                    {financials.receivables_paise > 0 && (
                        <div className="mt-2 p-2 bg-blue-900/30 rounded border border-blue-500/30 text-xs">
                            <span className="block text-blue-200">Pending Receivables</span>
                            <span className="font-bold">₹{(financials.receivables_paise / 100).toLocaleString()}</span>
                        </div>
                    )}
                </div>
            </div>
        );
    };

    return (
        <div className="min-h-screen bg-gray-900 flex flex-col items-center">
            {/* Persistent Header */}
            <div className="w-full bg-gray-800 border-b border-gray-700 p-4 shadow-md flex justify-between items-center px-10">
                <div className="flex items-center gap-4">
                    <div className="bg-blue-600 rounded-full h-10 w-10 flex items-center justify-center font-bold text-xl">{team.id}</div>
                    <span className="text-xl font-bold text-white">{team.name}</span>
                </div>
                {cumulativeStats && (
                    <div className="flex gap-8 text-sm">
                        <div className="text-right">
                            <span className="block text-gray-400 text-xs uppercase">Q{gameState.currentQuarter} EBITDA</span>
                            <span className={`text-lg font-bold ${cumulativeStats.quarterEbitdaPaise >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                ₹{(cumulativeStats.quarterEbitdaPaise / 100).toLocaleString()}
                            </span>
                        </div>
                        {gameState.currentQuarter > 1 && (
                            <div className="text-right">
                                <span className="block text-gray-400 text-xs uppercase">Total Game EBITDA</span>
                                <span className={`text-lg font-bold ${cumulativeStats.totalGameEbitdaPaise >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                    ₹{(cumulativeStats.totalGameEbitdaPaise / 100).toLocaleString()}
                                </span>
                            </div>
                        )}
                        <div className="text-right">
                            <span className="block text-gray-400 text-xs uppercase">Cash Balance</span>
                            <span className="text-lg font-bold text-white">
                                ₹{(cumulativeStats.closingCashPaise / 100).toLocaleString()}
                            </span>
                        </div>
                    </div>
                )}
            </div>
            {/* Main Content */}
            <div className="w-full max-w-7xl mt-6 px-4 grid grid-cols-1 lg:grid-cols-4 gap-6">
                {/* Left Sidebar */}
                <div className="lg:col-span-1 hidden lg:block">
                    <FinancialsSidebar />
                </div>

                {/* Main Area */}
                <div className="lg:col-span-3 space-y-8">
                    {renderPhaseContent()}

                    {/* NEW: Financial Reports Section */}
                    {history && history.length > 0 && (
                        <div className="bg-gray-800 rounded-lg p-6 shadow-xl border border-gray-700">
                            <h2 className="text-2xl font-bold mb-6 text-gray-200 border-b border-gray-700 pb-2 flex justify-between items-center">
                                <span>📊 Financial Reports</span>
                                <button onClick={() => {
                                    socket?.emit('get_team_history', { teamId: team.id });
                                    socket?.emit('get_leaderboard', { quarterId: gameState.currentQuarter || 1 });
                                }} className="text-sm bg-blue-600 hover:bg-blue-500 px-3 py-1 rounded text-white">
                                    Refresh Reports & Rankings
                                </button>
                            </h2>
                            {/* ... (Report Tables) ... */}
                            {/* Table A: Monthly Performance */}
                            <div className="mb-8">
                                <h3 className="text-lg font-bold text-yellow-500 mb-3">Monthly Performance</h3>
                                <div className="overflow-x-auto">
                                    <table className="w-full text-xs text-left text-gray-300 border-collapse">
                                        <thead className="bg-gray-700 text-gray-400 font-bold uppercase whitespace-nowrap">
                                            <tr>
                                                <th className="p-2 border border-gray-600">Month</th>
                                                <th className="p-2 border border-gray-600 text-right">M3 Alloc</th>
                                                <th className="p-2 border border-gray-600 text-right">Rev (₹)</th>
                                                <th className="p-2 border border-gray-600 text-right">Rev/m3</th>
                                                <th className="p-2 border border-gray-600 text-right">RM Cost (₹)</th>
                                                <th className="p-2 border border-gray-600 text-right">RM/m3</th>
                                                <th className="p-2 border border-gray-600 text-right">TM Cost (₹)</th>
                                                <th className="p-2 border border-gray-600 text-right">TM/m3</th>
                                                <th className="p-2 border border-gray-600 text-right">Prod (₹)</th>
                                                <th className="p-2 border border-gray-600 text-right">Prod/m3</th>
                                                <th className="p-2 border border-gray-600 text-right">EBITDA (₹)</th>
                                                <th className="p-2 border border-gray-600 text-right">EBITDA/m3</th>
                                                <th className="p-2 border border-gray-600 text-center">Cum EBITDA</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-700">
                                            {history.map((row: any, i: number) => {
                                                const cumEbitda = history.slice(0, i + 1).reduce((sum: number, r: any) => sum + r.ebitdaPaise, 0);
                                                const revPerM3 = row.salesVolume > 0 ? (row.revenuePaise / row.salesVolume) : 0;
                                                const rmPerM3 = row.salesVolume > 0 ? (row.rmCostPaise / row.salesVolume) : 0;
                                                const tmPerM3 = row.salesVolume > 0 ? (row.tmCostPaise / row.salesVolume) : 0;
                                                const prodPerM3 = row.salesVolume > 0 ? (row.prodCostPaise / row.salesVolume) : 0;
                                                const ebitdaPerM3 = row.salesVolume > 0 ? (row.ebitdaPaise / row.salesVolume) : 0;

                                                return (
                                                    <tr key={i} className="hover:bg-gray-700/30">
                                                        <td className="p-2 border border-gray-600 font-bold bg-gray-800">Q{row.quarter}-M{row.month}</td>
                                                        <td className="p-2 border border-gray-600 text-right">{row.salesVolume.toLocaleString()}</td>
                                                        <td className="p-2 border border-gray-600 text-right text-green-300">{(row.revenuePaise / 100).toLocaleString()}</td>
                                                        <td className="p-2 border border-gray-600 text-right">{(revPerM3 / 100).toFixed(0)}</td>
                                                        <td className="p-2 border border-gray-600 text-right text-red-300">{(row.rmCostPaise / 100).toLocaleString()}</td>
                                                        <td className="p-2 border border-gray-600 text-right">{(rmPerM3 / 100).toFixed(0)}</td>
                                                        <td className="p-2 border border-gray-600 text-right text-red-300">{(row.tmCostPaise / 100).toLocaleString()}</td>
                                                        <td className="p-2 border border-gray-600 text-right">{(tmPerM3 / 100).toFixed(0)}</td>
                                                        <td className="p-2 border border-gray-600 text-right text-red-300">{(row.prodCostPaise / 100).toLocaleString()}</td>
                                                        <td className="p-2 border border-gray-600 text-right">{(prodPerM3 / 100).toFixed(0)}</td>
                                                        <td className={`p-2 border border-gray-600 text-right font-bold ${row.ebitdaPaise >= 0 ? 'text-green-400' : 'text-red-400'}`}>{(row.ebitdaPaise / 100).toLocaleString()}</td>
                                                        <td className="p-2 border border-gray-600 text-right">{(ebitdaPerM3 / 100).toFixed(0)}</td>
                                                        <td className={`p-2 border border-gray-600 text-right font-bold ${cumEbitda >= 0 ? 'text-green-400' : 'text-red-400'}`}>{(cumEbitda / 100).toLocaleString()}</td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div >
                            </div >

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                {/* Table B: RM & TM Cost Tracking */}
                                <div>
                                    <h3 className="text-lg font-bold text-blue-400 mb-3">RM & TM Cost Tracking</h3>
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-xs text-left text-gray-300 border-collapse">
                                            <thead className="bg-gray-700 text-gray-400 font-bold uppercase">
                                                <tr>
                                                    <th className="p-2 border border-gray-600">Month</th>
                                                    <th className="p-2 border border-gray-600 text-right">Extra RM (m3)</th>
                                                    <th className="p-2 border border-gray-600 text-right">Extra RM Cost/m3</th>
                                                    <th className="p-2 border border-gray-600 text-right">Extra TM</th>
                                                    <th className="p-2 border border-gray-600 text-right">Extra TM Cost/m3</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-gray-700">
                                                {history.map((row: any, i: number) => (
                                                    <tr key={i} className="hover:bg-gray-700/30">
                                                        <td className="p-2 border border-gray-600 font-bold bg-gray-800">Q{row.quarter}-M{row.month}</td>
                                                        <td className="p-2 border border-gray-600 text-right">{row.extraRmVolume > 0 ? row.extraRmVolume.toLocaleString() : '-'}</td>
                                                        <td className="p-2 border border-gray-600 text-right">{row.extraRmCostPerM3 > 0 ? (row.extraRmCostPerM3 / 100).toLocaleString() : '-'}</td>
                                                        <td className="p-2 border border-gray-600 text-right">{row.extraTmAdded > 0 ? row.extraTmAdded : '-'}</td>
                                                        <td className="p-2 border border-gray-600 text-right">{row.extraTmCostPerM3 > 0 ? (row.extraTmCostPerM3 / 100).toLocaleString() : '-'}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>

                                {/* Table C: Cash Flow Statement */}
                                <div>
                                    <h3 className="text-lg font-bold text-green-400 mb-3">Cash Flow Statement</h3>
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-xs text-left text-gray-300 border-collapse">
                                            <thead className="bg-gray-700 text-gray-400 font-bold uppercase">
                                                <tr>
                                                    <th className="p-2 border border-gray-600">Month</th>
                                                    <th className="p-2 border border-gray-600 text-right">Opening</th>
                                                    <th className="p-2 border border-gray-600 text-right text-green-300">+ Received</th>
                                                    <th className="p-2 border border-gray-600 text-right text-blue-300">+ Loan</th>
                                                    <th className="p-2 border border-gray-600 text-right text-red-300">- Paid</th>
                                                    <th className="p-2 border border-gray-600 text-right font-bold w-24">Closing</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-gray-700">
                                                {history.map((row: any, i: number) => (
                                                    <tr key={i} className="hover:bg-gray-700/30">
                                                        <td className="p-2 border border-gray-600 font-bold bg-gray-800">Q{row.quarter}-M{row.month}</td>
                                                        <td className="p-2 border border-gray-600 text-right">{(row.openingCashPaise / 100).toLocaleString()}</td>
                                                        <td className="p-2 border border-gray-600 text-right text-green-300">{(row.paymentReceivedPaise / 100).toLocaleString()}</td>
                                                        <td className="p-2 border border-gray-600 text-right text-blue-300">{row.loanTakenPaise > 0 ? (row.loanTakenPaise / 100).toLocaleString() : '-'}</td>
                                                        <td className="p-2 border border-gray-600 text-right text-red-300">{(row.amountPaidPaise / 100).toLocaleString()}</td>
                                                        <td className={`p-2 border border-gray-600 text-right font-bold ${row.closingCashPaise < 0 ? 'text-red-400' : 'text-white'}`}>
                                                            {(row.closingCashPaise / 100).toLocaleString()}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            </div>

                            {/* Table D: Per m³ Cost Analysis */}
                            <div className="bg-gray-700/30 p-4 rounded border border-cyan-500/30">
                                <h4 className="text-sm font-bold text-cyan-400 mb-3 flex items-center gap-2">
                                    <span>📊</span> Per m³ Cost Analysis
                                </h4>
                                <div className="overflow-x-auto">
                                    <table className="w-full text-xs text-left text-gray-300 border-collapse">
                                        <thead className="bg-gray-700 text-gray-400 font-bold uppercase">
                                            <tr>
                                                <th className="p-2 border border-gray-600">Month</th>
                                                <th className="p-2 border border-gray-600 text-right">Sales (m³)</th>
                                                <th className="p-2 border border-gray-600 text-right">RM/m³</th>
                                                <th className="p-2 border border-gray-600 text-right">TM/m³</th>
                                                <th className="p-2 border border-gray-600 text-right">Prod/m³</th>
                                                <th className="p-2 border border-gray-600 text-right">Total Cost/m³</th>
                                                <th className="p-2 border border-gray-600 text-right">Revenue/m³</th>
                                                <th className="p-2 border border-gray-600 text-right">EBITDA/m³</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-700">
                                            {history.map((row: any, i: number) => {
                                                const salesVol = row.salesVolume || 0;
                                                const rmPerM3 = salesVol > 0 ? (row.rmCostPaise || 0) / salesVol / 100 : 0;
                                                const tmPerM3 = salesVol > 0 ? (row.tmCostPaise || 0) / salesVol / 100 : 0;
                                                const prodPerM3 = salesVol > 0 ? (row.prodCostPaise || 0) / salesVol / 100 : 0;
                                                const totalCostPerM3 = rmPerM3 + tmPerM3 + prodPerM3;
                                                const revenuePerM3 = salesVol > 0 ? (row.revenuePaise || 0) / salesVol / 100 : 0;
                                                const ebitdaPerM3 = salesVol > 0 ? (row.ebitdaPaise || 0) / salesVol / 100 : 0;

                                                return (
                                                    <tr key={i} className="hover:bg-gray-700/30">
                                                        <td className="p-2 border border-gray-600 font-bold bg-gray-800">Q{row.quarter}-M{row.month}</td>
                                                        <td className="p-2 border border-gray-600 text-right text-cyan-300">{salesVol.toLocaleString()}</td>
                                                        <td className="p-2 border border-gray-600 text-right text-orange-300">₹{rmPerM3.toFixed(2)}</td>
                                                        <td className="p-2 border border-gray-600 text-right text-blue-300">₹{tmPerM3.toFixed(2)}</td>
                                                        <td className="p-2 border border-gray-600 text-right text-purple-300">₹{prodPerM3.toFixed(2)}</td>
                                                        <td className="p-2 border border-gray-600 text-right text-red-300 font-bold">₹{totalCostPerM3.toFixed(2)}</td>
                                                        <td className="p-2 border border-gray-600 text-right text-green-300">₹{revenuePerM3.toFixed(2)}</td>
                                                        <td className={`p-2 border border-gray-600 text-right font-bold ${ebitdaPerM3 >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                                            ₹{ebitdaPerM3.toFixed(2)}
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div >
                    )}

                    {/* NEW: Competition Leaderboard */}
                    <LeaderboardTable data={leaderboardData} myTeamId={team.id} />
                </div >
            </div >
        </div >
    );
};



const GameRulesInfo = ({ teamName }: { teamName: string }) => {
    return (
        <div className="max-w-4xl mx-auto space-y-8 pb-10">
            <div className="bg-gray-800 p-6 rounded-lg border border-yellow-500/50 shadow-2xl text-center">
                <h1 className="text-3xl font-bold text-yellow-400 mb-2">HI {teamName}! Dr. Bhoon Welcomes You to this Exciting Game</h1>
                <p className="text-gray-300">Please read the following information carefully before the game starts.</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Market & Capacity */}
                <div className="bg-gray-800 p-6 rounded-lg border border-gray-700">
                    <h2 className="text-xl font-bold text-blue-400 mb-4 flex items-center gap-2"><span>📉</span> Market Size & Capacity</h2>
                    <ul className="list-disc list-inside space-y-2 text-gray-300 text-sm">
                        <li><strong>Market Size:</strong> No. of Players × 50,000 m³ (per month)</li>
                        <li><strong>Your Capacity:</strong> 50,000 m³ per month (Maximum bid limit)</li>
                    </ul>
                </div>

                {/* Working Capital */}
                <div className="bg-gray-800 p-6 rounded-lg border border-gray-700">
                    <h2 className="text-xl font-bold text-green-400 mb-4 flex items-center gap-2"><span>💰</span> Working Capital</h2>
                    <ul className="list-disc list-inside space-y-2 text-gray-300 text-sm">
                        <li><strong>Initial Seed:</strong> ₹10 Cr (Interest-free)</li>
                        <li><strong>Borrowing:</strong> Up to ₹10 Cr @ 2% / month interest</li>
                        <li><strong>Max Limit:</strong> ₹20 Cr Total Working Capital</li>
                    </ul>
                </div>
            </div>

            {/* Customers */}
            <div className="bg-gray-800 p-6 rounded-lg border border-gray-700">
                <h2 className="text-xl font-bold text-pink-400 mb-4 flex items-center gap-2"><span>👥</span> Four Customers</h2>
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm text-gray-300">
                        <thead className="bg-gray-700/50 text-xs uppercase font-bold text-gray-400">
                            <tr>
                                <th className="p-3">Customer</th>
                                <th className="p-3 text-right">Market Share</th>
                                <th className="p-3 text-right">Payment Terms</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-700">
                            <tr><td className="p-3 font-bold text-white">Laddu</td><td className="p-3 text-right">40%</td><td className="p-3 text-right">60 Days</td></tr>
                            <tr><td className="p-3 font-bold text-white">Shahi</td><td className="p-3 text-right">30%</td><td className="p-3 text-right">30 Days</td></tr>
                            <tr><td className="p-3 font-bold text-white">Lemon</td><td className="p-3 text-right">20%</td><td className="p-3 text-right text-green-400">Immediate</td></tr>
                            <tr><td className="p-3 font-bold text-white">Jamoon</td><td className="p-3 text-right">10%</td><td className="p-3 text-right text-green-400">Immediate</td></tr>
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Resources */}
            <div className="bg-gray-800 p-6 rounded-lg border border-gray-700">
                <h2 className="text-xl font-bold text-orange-400 mb-4 flex items-center gap-2"><span>📦</span> Resources (Beginning of Month)</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                        <h3 className="font-bold text-white mb-2">Raw Material (RM)</h3>
                        <ul className="list-disc list-inside space-y-1 text-gray-300 text-sm">
                            <li>Bidding determines allocation % (100% → 90% → ... → 40%)</li>
                            <li><strong>Shortage Penalty:</strong> Highest Bid + 10%</li>
                            <li><strong>Inventory Cost:</strong> 10% of Highest Bid (on closing stock)</li>
                            <li>RM Balance sold at lowest bid price at game end.</li>
                        </ul>
                    </div>
                    <div>
                        <h3 className="font-bold text-white mb-2">Transit Mixer (TM)</h3>
                        <ul className="list-disc list-inside space-y-1 text-gray-300 text-sm">
                            <li><strong>Capacity:</strong> 540 m³ / month per TM</li>
                            <li><strong>Cost:</strong> ₹1,80,000 per TM</li>
                            <li><strong>Shortage Penalty:</strong> Auto-allotted @ ₹2,58,000 / month</li>
                        </ul>
                    </div>
                </div>
            </div>

            {/* Production Costs */}
            <div className="bg-gray-800 p-6 rounded-lg border border-gray-700">
                <h2 className="text-xl font-bold text-purple-400 mb-4 flex items-center gap-2"><span>🏭</span> Production Cost (Tiered)</h2>
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm text-gray-300">
                        <thead className="bg-gray-700/50 text-xs uppercase font-bold text-gray-400">
                            <tr>
                                <th className="p-3">Volume Range (m³)</th>
                                <th className="p-3 text-right">Cost per m³</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-700">
                            <tr><td className="p-3">&gt; 30,000</td><td className="p-3 text-right font-bold text-green-400">₹400</td></tr>
                            <tr><td className="p-3">20,000 - 30,000</td><td className="p-3 text-right">₹500</td></tr>
                            <tr><td className="p-3">10,000 - 20,000</td><td className="p-3 text-right">₹600</td></tr>
                            <tr><td className="p-3 bg-red-900/10">&lt; 10,000</td><td className="p-3 text-right font-bold text-red-400">₹700</td></tr>
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Game Flow */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-gray-800 p-6 rounded-lg border border-gray-700">
                    <h2 className="text-xl font-bold text-cyan-400 mb-4 flex items-center gap-2"><span>🎯</span> Auction Cycles</h2>
                    <ul className="list-disc list-inside space-y-2 text-gray-300 text-sm">
                        <li>3 Monthly Cycles per Quarter</li>
                        <li>Reverse Auction for Sales Volume</li>
                        <li><strong>Max Selling Price:</strong> ₹7,000 / m³</li>
                        <li>You decide Price & Qty for each customer.</li>
                    </ul>
                </div>
                <div className="bg-gray-800 p-6 rounded-lg border border-gray-700">
                    <h2 className="text-xl font-bold text-indigo-400 mb-4 flex items-center gap-2"><span>⏱️</span> Duration & Financials</h2>
                    <ul className="list-disc list-inside space-y-2 text-gray-300 text-sm">
                        <li><strong>Start:</strong> 15 mins for strategy/planning</li>
                        <li><strong>Duration:</strong> Max 4 Quarters</li>
                        <li><strong>Payments:</strong> TM/RM payments auto-debited monthly.</li>
                        <li>Closing Balance shown monthly.</li>
                    </ul>
                </div>
            </div>

            <div className="text-center text-gray-500 text-xs mt-8">
                Waiting for Admin to Start Game...
            </div>
        </div>
    );
};

const LeaderboardTable = ({ data, myTeamId }: { data: any[], myTeamId: number }) => {
    if (!data || data.length === 0) {
        return (
            <div className="bg-gray-800 rounded-lg p-6 shadow-xl border border-gray-700 mt-8 opacity-75">
                <h2 className="text-xl font-bold mb-4 text-yellow-500 flex items-center gap-2">
                    <span>🏆</span> Competition Leaderboard
                </h2>
                <div className="text-gray-400 text-sm italic py-4 text-center">
                    Waiting for rankings... (Data will appear after Month 1)
                </div>
            </div>
        );
    }

    return (
        <div className="bg-gray-800 rounded-lg p-6 shadow-xl border border-gray-700 mt-8">
            <h2 className="text-xl font-bold mb-4 text-yellow-500 flex items-center gap-2">
                <span>🏆</span> Competition Leaderboard
            </h2>
            <div className="overflow-x-auto">
                <table className="w-full text-left text-sm text-gray-300">
                    <thead className="bg-gray-700/50 text-xs uppercase font-bold text-gray-400">
                        <tr>
                            <th className="p-3">Rank</th>
                            <th className="p-3">Team</th>
                            <th className="p-3 text-right">Total Game EBITDA</th>
                            <th className="p-3 text-right">Current Q EBITDA</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-700">
                        {data.map((row, i) => (
                            <tr key={i} className={`hover:bg-gray-700/30 transition-colors ${row.teamId === myTeamId ? 'bg-blue-900/30 border-l-4 border-blue-500' : ''}`}>
                                <td className="p-3 font-bold text-white">#{i + 1}</td>
                                <td className="p-3 font-bold text-white">
                                    {row.teamName}
                                </td>
                                <td className={`p-3 text-right font-bold ${row.totalGameEbitdaPaise >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                    ₹{(row.totalGameEbitdaPaise / 100).toLocaleString()}
                                </td>
                                <td className="p-3 text-right text-gray-400">
                                    ₹{(row.quarterEbitdaPaise / 100).toLocaleString()}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default TeamDashboard;

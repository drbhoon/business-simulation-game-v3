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
        return () => {
            socket.off('bid_success');
            socket.off('error_message');
        };
    }, [socket]);

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
        };
        fetchStats();
        const interval = setInterval(fetchStats, 5000);
        socket.on('my_cumulative_financials', (data) => setCumulativeStats(data));
        return () => {
            clearInterval(interval);
            socket.off('my_cumulative_financials');
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
            if (gameState.currentQuarter > 1) {
                return (
                    <div className="p-10 text-center text-white bg-gray-800 rounded-lg max-w-2xl mx-auto mt-10 shadow-lg border border-blue-500/30">
                        <h1 className="text-4xl font-black text-blue-400 mb-4 animate-pulse">QUARTER {gameState.currentQuarter} STARTING</h1>
                        <p className="text-xl text-gray-300">Standby for Q{gameState.currentQuarter} RM and TM bidding...</p>
                    </div>
                );
            }
            // For Q1 Lobby, we usually don't reach here due to Lobby.tsx logic, but if we do:
            return (
                <div className="p-10 text-center text-white bg-gray-800 rounded">
                    <h2 className="text-2xl">Welcome, {team.name}</h2>
                    <p className="text-gray-400">Waiting for Admin to Start Game...</p>
                </div>
            );
        }

        if (gameState.phase === 'QUARTER_START') {
            return (
                <div className="p-6 bg-gray-800 text-white rounded-lg shadow-xl max-w-2xl mx-auto mt-10">
                    <h2 className="text-3xl font-bold mb-6 text-blue-400">Quarter {Math.max(gameState.currentQuarter, 1)} Planning</h2>
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
                                placeholder="Max 150000"
                                onChange={(e) => setBidVolume(e.target.value)}
                                disabled={isBidSubmitted}
                            />
                            <p className="text-xs text-gray-400 mt-1">Max Capacity: 150,000 m³</p>
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
                <div className="lg:col-span-3">
                    {renderPhaseContent()}
                </div>
            </div>
        </div>
    );
};



export default TeamDashboard;

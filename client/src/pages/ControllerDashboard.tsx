import React, { useEffect, useState } from 'react';
import { useSocket } from '../contexts/SocketContext';

// Types
interface Team {
    id: number;
    name: string;
}

interface AllocationResult {
    teamId: number;
    bidPricePaise: number;
    bidVolume: number;
    rank: number;
    allocatedVolume: number;
    allocationFactor: number;
}

const ControllerDashboard: React.FC = () => {
    const socket = useSocket();
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [passwordInput, setPasswordInput] = useState('');

    // Game Data
    const [gameState, setGameState] = useState<any>(null);
    const [teams, setTeams] = useState<Team[]>([]);
    const [allocations, setAllocations] = useState<AllocationResult[]>([]);
    const [financialsData, setFinancialsData] = useState<any[]>([]);
    const [leaderboardData, setLeaderboardData] = useState<any[]>([]);
    const [teamStatuses, setTeamStatuses] = useState<Record<number, { hasBidRM: boolean, hasBidAuction: boolean }>>({});
    const [msg, setMsg] = useState('');

    useEffect(() => {
        if (!socket) return;
        if (!isAuthenticated) return;

        socket.emit('get_initial_state');

        socket.on('game_state_update', (st) => {
            setGameState(st);
            // If we are past allocation phase, fetch results automatically
            if (['MONTH_START', 'CUSTOMER_AUCTION_PREROLL', 'CUSTOMER_AUCTION', 'MONTH_END'].includes(st.phase)) {
                socket.emit('get_allocations', { quarterId: st.currentQuarter || 1 });
            }
            // Fetch status whenever state changes
            socket.emit('get_team_status', { quarterId: st.currentQuarter || 1 });
        });

        socket.on('teams_update', (t) => setTeams(t));
        socket.on('team_status_update', (s) => setTeamStatuses(s));

        socket.on('allocation_results', (res) => {
            console.log("Received allocations:", res);
            setAllocations(res);
            if (res.length > 0) setMsg('Allocations Loaded');
        });

        socket.on('game_reset', (newState) => {
            setGameState(newState);
            setTeams([]);
            setAllocations([]);
            setTeamStatuses({});
            setMsg('Game has been reset to Lobby.');
        });

        socket.on('error_message', (m) => setMsg('Error: ' + m));

        // Financials Listeners
        socket.on('all_month_financials_results', (res) => {
            console.log("Controller received financials:", res);
            setFinancialsData(res);
        });

        socket.on('leaderboard_results', (res) => {
            setLeaderboardData(res);
        });

        socket.on('financials_updated', () => {
            // Optional: Trigger fetch if needed
            if (gameState) {
                socket.emit('get_all_month_financials', {
                    quarterId: gameState.currentQuarter || 1,
                    monthId: gameState.currentMonthWithinQuarter || 1
                });
            }
        });

        return () => {
            socket.off('game_state_update');
            socket.off('teams_update');
            socket.off('team_status_update');
            socket.off('allocation_results');
            socket.off('game_reset');
            socket.off('error_message');
            socket.off('all_month_financials_results');
            socket.off('leaderboard_results');
            socket.off('financials_updated');
        };
    }, [socket, isAuthenticated, gameState]);

    // ... (rest of code)

    {/* Progress: Team List */ }
    <div className="bg-gray-800 p-4 rounded-lg border border-gray-700">
        <h3 className="text-sm font-bold mb-2 text-gray-200">Registered Teams ({teams.length})</h3>
        <ul className="space-y-1 max-h-40 overflow-y-auto custom-scrollbar">
            {teams.map(t => {
                const status = teamStatuses[t.id];
                let isSubmitted = false;

                // Determine if submitted based on phase
                if (gameState?.phase === 'LOBBY' || gameState?.phase === 'QUARTER_START' || gameState?.phase === 'QUARTER_PREROLL') {
                    isSubmitted = status?.hasBidRM || false;
                } else if (gameState?.phase === 'CUSTOMER_AUCTION' || gameState?.phase === 'CUSTOMER_AUCTION_PREROLL') {
                    isSubmitted = status?.hasBidAuction || false;
                }

                return (
                    <li key={t.id} className="flex justify-between items-center p-2 bg-gray-700/50 rounded text-xs">
                        <span className="font-medium text-white">{t.name}</span>
                        <div className="flex items-center gap-2">
                            <span className="text-gray-500">ID: {t.id}</span>
                            {isSubmitted ? (
                                <span className="text-green-400 font-bold px-1 bg-green-900/30 rounded">✅ Submitted</span>
                            ) : (
                                <span className="text-yellow-500 font-bold px-1 bg-yellow-900/30 rounded animate-pulse">⏳ Waiting</span>
                            )}
                        </div>
                    </li>
                );
            })}
        </ul>
    </div>

    // Fetch financials whenever we have a valid socket and gameState, or on specific phases
    useEffect(() => {
        if (!socket || !gameState) return;
        const m = gameState.currentMonthWithinQuarter || 1;
        // Fetch initially and when requested
        socket.emit('get_all_month_financials', { quarterId: gameState.currentQuarter || 1, monthId: m });

        const handleUpdate = () => {
            socket.emit('get_all_month_financials', { quarterId: gameState.currentQuarter || 1, monthId: m });
        };
        socket.on('financials_updated', handleUpdate);
        return () => { socket.off('financials_updated', handleUpdate); };
    }, [socket, gameState?.currentQuarter, gameState?.currentMonthWithinQuarter]);

    const handleLogin = (e: React.FormEvent) => {
        e.preventDefault();
        // Simple client-side check for demo, real auth should be on connection/token
        if (passwordInput === 'admin123') {
            setIsAuthenticated(true);
        } else {
            alert("Invalid Password");
        }
    };

    const startPreroll = () => {
        if (socket) socket.emit('admin_set_phase', { phase: 'QUARTER_PREROLL', password: 'admin123' });
    };

    const [isProcessing, setIsProcessing] = useState(false);

    const openBidding = () => {
        if (socket) socket.emit('admin_set_phase', { phase: 'QUARTER_START', password: 'admin123' });
    };

    const resetGame = () => {
        if (socket) {
            socket.emit('admin_reset_game', 'admin123');
            setAllocations([]);
            setMsg('Game Reset');
        }
    };

    const processAllocations = () => {
        if (socket && gameState) {
            setIsProcessing(true);
            setMsg("Processing...");
            socket.emit('admin_process_allocations', { quarterId: gameState.currentQuarter || 1 });
            setTimeout(() => setIsProcessing(false), 2000);
        }
    };
    const handleProcessAllocation = processAllocations;

    // LOGIN SCREEN
    if (!isAuthenticated) {
        return (
            <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
                <form onSubmit={handleLogin} className="bg-gray-800 p-8 rounded shadow-lg border border-gray-700 w-full max-w-sm">
                    <h1 className="text-2xl font-bold text-white mb-6 text-center">Admin Login</h1>
                    <input
                        type="password"
                        value={passwordInput}
                        onChange={e => setPasswordInput(e.target.value)}
                        placeholder="Admin Password"
                        className="w-full p-3 rounded bg-gray-700 text-white border border-gray-600 mb-4 focus:ring-2 focus:ring-blue-500 outline-none"
                    />
                    <button type="submit" className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 rounded">
                        Enter Controller
                    </button>
                </form>
            </div>
        );
    }

    if (!gameState) return <div className="text-white p-10">Loading Controller State...</div>;

    return (
        <div className="p-6 bg-gray-900 text-white min-h-screen font-sans">
            {/* Header with Logo */}
            <div className="flex flex-col items-center mb-8 border-b border-gray-700 pb-4">
                <img src="/rdc_logo.png" alt="RDC Logo" className="h-20 mb-4 object-contain" />
                <div className="flex justify-between items-center w-full">
                    <h1 className="text-3xl font-bold text-purple-400">Admin Controller</h1>
                    <div className="flex gap-4">
                        <div className="bg-gray-800 px-4 py-2 rounded">
                            <span className="text-xs text-gray-400 block">PHASE</span>
                            <span className="font-mono text-green-400 font-bold">{gameState.phase}</span>
                        </div>
                        <div className="bg-gray-800 px-4 py-2 rounded">
                            <span className="text-xs text-gray-400 block">QUARTER</span>
                            <div className="font-mono text-xl text-blue-400">{gameState.currentQuarter}</div>
                        </div>
                        <div className="bg-gray-800 px-4 py-2 rounded">
                            <span className="text-xs text-gray-400 block">MONTH</span>
                            <div className="font-mono text-xl text-yellow-400">{gameState.currentMonthWithinQuarter}</div>
                        </div>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                {/* Left Col: Financials Data (Wider) */}
                <div className="lg:col-span-8 space-y-6">
                    <div className="bg-gray-800 p-6 rounded-lg border border-gray-700 shadow-xl">
                        <h3 className="text-xl font-bold mb-4 text-green-400 flex items-center gap-2">
                            <span>💰</span> Financials Overview (Quarter {gameState.currentQuarter || 1}, Month {gameState.currentMonthWithinQuarter || 1})
                        </h3>
                        <FinancialsTable
                            data={financialsData}
                            forceRefresh={() => socket?.emit('get_all_month_financials', { quarterId: gameState.currentQuarter || 1, monthId: gameState.currentMonthWithinQuarter || 1 })}
                            onRecalculate={() => socket?.emit('admin_recalculate_financials', { quarterId: gameState.currentQuarter || 1 })}
                        />
                    </div>

                    {/* PER M³ COST ANALYSIS TABLE */}
                    <div className="bg-gray-800 p-6 rounded-lg border border-gray-700 shadow-xl">
                        <h3 className="text-xl font-bold mb-4 text-cyan-400 flex items-center gap-2">
                            <span>📊</span> Per m³ Cost Analysis (Quarter {gameState.currentQuarter || 1}, Month {gameState.currentMonthWithinQuarter || 1})
                        </h3>
                        <PerM3CostTable data={financialsData} />
                    </div>

                    {/* LEADERBOARD TABLE */}
                    <div className="bg-gray-800 p-6 rounded-lg border border-gray-700 shadow-xl">
                        <h3 className="text-xl font-bold mb-4 text-yellow-400 flex items-center gap-2">
                            <span>🏆</span> Cumulative Leaderboard
                        </h3>
                        <LeaderboardTable data={leaderboardData} />
                    </div>
                </div>

                {/* Right Col: Controls & Progress (Narrower) */}
                <div className="lg:col-span-4 space-y-6">
                    {msg && (
                        <div className="bg-blue-900/20 border-l-4 border-blue-500 p-4 font-mono text-sm text-blue-200 animate-pulse">
                            {msg}
                        </div>
                    )}

                    {/* Game Controls */}
                    <div className="bg-gray-800 p-6 rounded-lg border border-gray-700">
                        <h3 className="text-xl font-bold mb-4 text-gray-200">Game Flow Control</h3>

                        <div className="space-y-4">
                            {/* PHASE SPECIFIC ACTIONS */}
                            {gameState.phase === 'LOBBY' && (
                                <button
                                    onClick={startPreroll}
                                    className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 rounded shadow-lg"
                                >
                                    Start RM & TM BID - M{gameState.currentMonthWithinQuarter || 1}
                                </button>
                            )}

                            {gameState.phase === 'QUARTER_PREROLL' && (
                                <div className="space-y-2 p-4 bg-gray-700/50 rounded border border-blue-500/30">
                                    <div className="text-sm text-blue-200 mb-2">
                                        <span className="animate-pulse">●</span> Teams: "Get Ready..."
                                    </div>
                                    <button
                                        onClick={openBidding}
                                        className="w-full bg-green-600 hover:bg-green-500 text-white font-bold py-3 rounded shadow-lg animate-pulse"
                                    >
                                        OPEN BIDDING NOW
                                    </button>
                                </div>
                            )}

                            {gameState.phase === 'QUARTER_START' && (
                                <div className="space-y-2">
                                    <div className="text-sm text-gray-400 mb-2">Wait for all bids...</div>
                                    <button
                                        onClick={handleProcessAllocation}
                                        disabled={isProcessing}
                                        className={`w-full py-3 rounded font-bold shadow-lg transition-all transform hover:scale-[1.02] ${isProcessing ? 'bg-gray-600 cursor-not-allowed' : 'bg-yellow-600 hover:bg-yellow-500 text-white'}`}
                                    >
                                        {isProcessing ? "Processing..." : `Allocate RM & TM - M${gameState.currentMonthWithinQuarter || 1}`}
                                    </button>
                                </div>
                            )}

                            {gameState.phase === 'MONTH_START' && (
                                <button
                                    onClick={() => socket?.emit('admin_set_phase', { phase: 'CUSTOMER_AUCTION_PREROLL', password: 'admin123' })}
                                    className="w-full bg-purple-600 hover:bg-purple-500 text-white font-bold py-3 rounded shadow-lg"
                                >
                                    Start Sale Auction - M{gameState.currentMonthWithinQuarter || 1}
                                </button>
                            )}

                            {gameState.phase === 'CUSTOMER_AUCTION_PREROLL' && (
                                <div className="space-y-2 p-4 bg-gray-700/50 rounded border border-purple-500/30">
                                    <div className="text-sm text-purple-200 mb-2">
                                        <span className="animate-pulse">●</span> Teams: "Get Ready for Auction..."
                                    </div>
                                    <button
                                        onClick={() => socket?.emit('admin_set_phase', { phase: 'CUSTOMER_AUCTION', password: 'admin123' })}
                                        className="w-full bg-pink-600 hover:bg-pink-500 text-white font-bold py-3 rounded shadow-lg animate-pulse"
                                    >
                                        START CUSTOMER AUCTION
                                    </button>
                                </div>
                            )}

                            {gameState.phase === 'CUSTOMER_AUCTION' && (
                                <div className="space-y-2">
                                    <div className="p-4 bg-gray-700/30 rounded text-center text-gray-400 text-sm">
                                        Monitor Auction Bids
                                    </div>
                                    <button
                                        onClick={() => socket?.emit('admin_process_customer_allocations', { quarterId: gameState.currentQuarter || 1 })}
                                        className="w-full bg-pink-600 hover:bg-pink-500 text-white font-bold py-3 rounded shadow-lg animate-pulse"
                                    >
                                        Declare Sales Auction - M{gameState.currentMonthWithinQuarter || 1}
                                    </button>
                                </div>
                            )}

                            {gameState.phase === 'MONTH_END' && (
                                <div className="space-y-2">
                                    <button
                                        onClick={() => socket?.emit('admin_recalculate_financials', { quarterId: gameState.currentQuarter || 1 })}
                                        className="w-full bg-yellow-600 hover:bg-yellow-500 text-white font-bold py-2 px-4 rounded text-sm shadow mb-2"
                                    >
                                        🔄 Recalculate Financials
                                    </button>
                                    <button
                                        onClick={() => socket?.emit('admin_advance_month', { quarterId: gameState.currentQuarter || 1 })}
                                        className="w-full bg-green-600 hover:bg-green-500 text-white font-bold py-3 px-4 rounded text-sm shadow"
                                    >
                                        Increment Month
                                    </button>
                                    <button
                                        onClick={() => socket?.emit('admin_end_game', 'admin123')}
                                        className="w-full bg-red-700 hover:bg-red-600 text-white font-bold py-2 px-4 rounded text-sm shadow mt-4 border border-red-500"
                                    >
                                        🏁 END GAME NOW
                                    </button>
                                </div>
                            )}

                            {gameState.phase === 'GAME_OVER' && (
                                <div className="space-y-4 p-4 bg-gray-700/50 rounded border border-yellow-500/50 animate-pulse">
                                    <div className="text-center">
                                        <h3 className="text-2xl font-black text-yellow-500 mb-2">GAME OVER</h3>
                                        <p className="text-gray-300 text-sm">Teams are viewing the final leaderboard.</p>
                                    </div>
                                    <button
                                        onClick={resetGame}
                                        className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 rounded shadow-lg"
                                    >
                                        RESET & START NEW GAME
                                    </button>
                                </div>
                            )}

                            <hr className="border-gray-700 my-4" />

                            <button
                                onClick={resetGame}
                                className="w-full bg-red-900/40 hover:bg-red-900 text-red-300 font-bold py-2 rounded border border-red-800 text-sm"
                            >
                                Reset Entire Game
                            </button>
                        </div>
                    </div>

                    {/* Progress: Team List */}
                    <div className="bg-gray-800 p-4 rounded-lg border border-gray-700 mb-6">
                        <h3 className="text-sm font-bold mb-2 text-gray-200">Registered Teams ({teams.length})</h3>
                        <ul className="space-y-1 max-h-40 overflow-y-auto custom-scrollbar">
                            {teams.map(t => {
                                const status = teamStatuses[t.id];
                                let isSubmitted = false;

                                // Determine if submitted based on phase
                                if (gameState?.phase === 'LOBBY' || gameState?.phase === 'QUARTER_START' || gameState?.phase === 'QUARTER_PREROLL') {
                                    isSubmitted = status?.hasBidRM || false;
                                } else if (gameState?.phase === 'CUSTOMER_AUCTION' || gameState?.phase === 'CUSTOMER_AUCTION_PREROLL') {
                                    isSubmitted = status?.hasBidAuction || false;
                                }

                                return (
                                    <li key={t.id} className="flex justify-between items-center p-2 bg-gray-700/50 rounded text-xs">
                                        <span className="font-medium text-white">{t.name}</span>
                                        <div className="flex items-center gap-2">
                                            <span className="text-gray-500">ID: {t.id}</span>
                                            {isSubmitted ? (
                                                <span className="text-green-400 font-bold px-1 bg-green-900/30 rounded">✅ Submitted</span>
                                            ) : (
                                                <span className="text-yellow-500 font-bold px-1 bg-yellow-900/30 rounded animate-pulse">⏳ Waiting</span>
                                            )}
                                        </div>
                                    </li>
                                );
                            })}
                        </ul>
                    </div>

                    {/* Progress: RM Allocations */}
                    {allocations.length > 0 && gameState.phase !== 'MONTH_END' && (
                        <div className="bg-gray-800 p-4 rounded-lg border border-gray-700 shadow-xl">
                            <h3 className="text-sm font-bold mb-3 text-yellow-400 flex items-center gap-2 uppercase">
                                <span>📊</span> RM Allocation
                            </h3>
                            <div className="overflow-x-auto max-h-60 overflow-y-auto">
                                <table className="w-full text-left text-xs text-gray-300">
                                    <thead className="bg-gray-700/50 sticky top-0">
                                        <tr>
                                            <th className="p-2">Team</th>
                                            <th className="p-2 text-right">RM Bid Price (₹)</th>
                                            <th className="p-2 text-right">RM Bid Qty</th>
                                            <th className="p-2 text-center">Rank</th>
                                            <th className="p-2 text-right">RM Allocated (%)</th>
                                            <th className="p-2 text-right">RM Allocated Qty</th>
                                            <th className="p-2 text-right">TM Bid Qty/Mo</th>
                                            <th className="p-2 text-right">TM Allocated/Mo</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-700">
                                        {allocations.map((row: any) => (
                                            <tr key={row.teamId} className="hover:bg-gray-700/30">
                                                <td className="p-2 font-bold text-white">{row.teamId}</td>
                                                <td className="p-2 text-right text-green-300">{(row.bidPricePaise / 100).toLocaleString()}</td>
                                                <td className="p-2 text-right text-gray-300">{row.bidVolume.toLocaleString()}</td>
                                                <td className="p-2 text-center font-bold text-yellow-500">#{row.rank}</td>
                                                <td className="p-2 text-right text-gray-400">{(row.allocationFactor * 100).toFixed(0)}%</td>
                                                <td className="p-2 text-right font-bold text-white">{row.allocatedVolume.toLocaleString()}</td>
                                                <td className="p-2 text-right text-blue-300">{row.tmCount || 0}</td>
                                                <td className="p-2 text-right font-bold text-blue-400">{row.tmCount || 0}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}

                    {/* Progress: Customer Allocations */}
                    {gameState.phase === 'MONTH_END' && (
                        <div className="bg-gray-800 p-4 rounded-lg border border-gray-700 shadow-xl">
                            <h3 className="text-sm font-bold mb-3 text-pink-400 flex items-center gap-2 uppercase">
                                <span>🚀</span> Customer Allocation
                            </h3>
                            <CustomerAllocationTable socket={socket} quarterId={gameState.currentQuarter || 1} />
                        </div>
                    )}


                </div>
            </div>
        </div>
    );
};

// Helper Component for Customer Table
const CustomerAllocationTable = ({ socket, quarterId }: { socket: any, quarterId: number }) => {
    const [data, setData] = useState<any[]>([]);

    useEffect(() => {
        if (!socket) return;
        socket.emit('get_customer_allocations', { quarterId });
        socket.on('customer_allocation_results', (res: any) => setData(res));
        return () => { socket.off('customer_allocation_results'); };
    }, [socket, quarterId]);

    if (data.length === 0) return <div className="text-gray-500 italic">No customer allocations yet.</div>;

    return (
        <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-gray-300">
                <thead className="bg-gray-700/50 text-xs uppercase font-bold text-gray-400">
                    <tr>
                        <th className="p-3">Customer</th>
                        <th className="p-3">Rank</th>
                        <th className="p-3">Team ID</th>
                        <th className="p-3 text-right">Ask Price</th>
                        <th className="p-3 text-right">Allocated Vol</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-gray-700">
                    {data.map((row, i) => (
                        <tr key={i} className="hover:bg-gray-700/30 transition-colors">
                            <td className="p-3 font-bold text-pink-300">{row.customerId}</td>
                            <td className="p-3 font-bold text-white">#{row.rank}</td>
                            <td className="p-3">{row.teamId}</td>
                            <td className="p-3 text-right text-green-300">₹{(row.bidPricePaise / 100).toLocaleString()}</td>
                            <td className="p-3 text-right font-bold text-white">{row.allocatedVolume.toLocaleString()}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
};

const FinancialsTable = ({ data, forceRefresh, onRecalculate }: { data: any[], forceRefresh: () => void, onRecalculate: () => void }) => {
    if (!data || data.length === 0) {
        return (
            <div className="flex flex-col gap-2 p-4 bg-gray-900/50 rounded">
                <div className="text-gray-500 italic">No financial data found.</div>
                <div className="flex gap-2">
                    <button
                        onClick={forceRefresh}
                        className="text-xs bg-blue-700 hover:bg-blue-600 text-white px-3 py-1 rounded"
                    >
                        Refresh View
                    </button>
                    <button
                        onClick={onRecalculate}
                        className="text-xs bg-yellow-700 hover:bg-yellow-600 text-white px-3 py-1 rounded"
                    >
                        Force Recalculate (Server)
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="overflow-x-auto relative">
            <button
                onClick={forceRefresh}
                className="absolute top-0 right-0 text-xs bg-gray-700 hover:bg-gray-600 text-white px-2 py-1 rounded z-10"
                title="Refresh Financials"
            >
                ↻
            </button>
            <table className="w-full text-left text-xs text-gray-300">
                <thead className="bg-gray-700/50 text-xs uppercase font-bold text-gray-400 sticky top-0">
                    <tr>
                        <th className="p-2">Team</th>
                        <th className="p-2 text-right">Sales Vol</th>
                        <th className="p-2 text-right">Revenue</th>
                        <th className="p-2 text-right">RM Cost</th>
                        <th className="p-2 text-right">TM Cost</th>
                        <th className="p-2 text-right">Prod Cost</th>
                        <th className="p-2 text-right">Expenses</th>
                        <th className="p-2 text-right">EBITDA</th>
                        <th className="p-2 text-right">Opening Cash</th>
                        <th className="p-2 text-right">Closing Cash</th>
                        <th className="p-2 text-right">RM Balance</th>
                        <th className="p-2 text-right">TM Count</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-gray-700">
                    {data.map((row, i) => (
                        <tr key={i} className="hover:bg-gray-700/30 transition-colors">
                            <td className="p-2 font-bold text-white">
                                {row.team_name} <span className="text-gray-500 text-xs font-normal">({row.team_id})</span>
                            </td>
                            <td className="p-2 text-right text-cyan-300">{(row.sales_volume || 0).toLocaleString()} m³</td>
                            <td className="p-2 text-right text-green-300">₹{((row.revenue_paise || 0) / 100).toLocaleString()}</td>
                            <td className="p-2 text-right text-orange-300">₹{((row.rm_cost_paise || 0) / 100).toLocaleString()}</td>
                            <td className="p-2 text-right text-blue-300">₹{((row.tm_cost_paise || 0) / 100).toLocaleString()}</td>
                            <td className="p-2 text-right text-purple-300">₹{((row.prod_cost_paise || 0) / 100).toLocaleString()}</td>
                            <td className="p-2 text-right text-red-300">₹{((row.expenses_paise || 0) / 100).toLocaleString()}</td>
                            <td className={`p-2 text-right font-bold ${(row.ebitda_paise || 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                ₹{((row.ebitda_paise || 0) / 100).toLocaleString()}
                            </td>
                            <td className="p-2 text-right text-gray-400">₹{((row.cash_opening_paise || 0) / 100).toLocaleString()}</td>
                            <td className="p-2 text-right text-white font-mono">₹{((row.cash_closing_paise || 0) / 100).toLocaleString()}</td>
                            <td className="p-2 text-right text-yellow-300">{(row.rm_closing_balance || 0).toLocaleString()} m³</td>
                            <td className="p-2 text-right text-cyan-300">{row.tm_count_current || 0}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
};

// Helper Component for Per m³ Cost Analysis Table
const PerM3CostTable = ({ data }: { data: any[] }) => {
    if (!data || data.length === 0) {
        return <div className="text-gray-500 italic p-4">No data available for cost analysis.</div>;
    }

    return (
        <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-gray-300">
                <thead className="bg-gray-700/50 text-xs uppercase font-bold text-gray-400 sticky top-0">
                    <tr>
                        <th className="p-2">Team</th>
                        <th className="p-2 text-right">Sales Vol (m³)</th>
                        <th className="p-2 text-right">RM/m³</th>
                        <th className="p-2 text-right">TM/m³</th>
                        <th className="p-2 text-right">Prod/m³</th>
                        <th className="p-2 text-right">Total Cost/m³</th>
                        <th className="p-2 text-right">Revenue/m³</th>
                        <th className="p-2 text-right">EBITDA/m³</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-gray-700">
                    {data.map((row, i) => {
                        const salesVol = row.sales_volume || 0;
                        const rmPerM3 = salesVol > 0 ? (row.rm_cost_paise || 0) / salesVol / 100 : 0;
                        const tmPerM3 = salesVol > 0 ? (row.tm_cost_paise || 0) / salesVol / 100 : 0;
                        const prodPerM3 = salesVol > 0 ? (row.prod_cost_paise || 0) / salesVol / 100 : 0;
                        const totalCostPerM3 = rmPerM3 + tmPerM3 + prodPerM3;
                        const revenuePerM3 = salesVol > 0 ? (row.revenue_paise || 0) / salesVol / 100 : 0;
                        const ebitdaPerM3 = salesVol > 0 ? (row.ebitda_paise || 0) / salesVol / 100 : 0;

                        return (
                            <tr key={i} className="hover:bg-gray-700/30 transition-colors">
                                <td className="p-2 font-bold text-white">
                                    {row.team_name} <span className="text-gray-500 text-xs font-normal">({row.team_id})</span>
                                </td>
                                <td className="p-2 text-right text-cyan-300">{salesVol.toLocaleString()}</td>
                                <td className="p-2 text-right text-orange-300">₹{rmPerM3.toFixed(2)}</td>
                                <td className="p-2 text-right text-blue-300">₹{tmPerM3.toFixed(2)}</td>
                                <td className="p-2 text-right text-purple-300">₹{prodPerM3.toFixed(2)}</td>
                                <td className="p-2 text-right text-red-300 font-bold">₹{totalCostPerM3.toFixed(2)}</td>
                                <td className="p-2 text-right text-green-300">₹{revenuePerM3.toFixed(2)}</td>
                                <td className={`p-2 text-right font-bold ${ebitdaPerM3 >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                    ₹{ebitdaPerM3.toFixed(2)}
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
};

// Helper Component for Leaderboard Table
const LeaderboardTable = ({ data }: { data: any[] }) => {
    if (!data || data.length === 0) return <div className="text-gray-500 italic p-4">No cumulative data available.</div>;

    return (
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
                        <tr key={i} className={`hover:bg-gray-700/30 transition-colors ${i === 0 ? 'bg-yellow-900/10' : ''}`}>
                            <td className="p-3 font-bold text-white">#{i + 1}</td>
                            <td className="p-3 font-bold text-white">
                                {row.teamName} <span className="text-gray-500 text-xs font-normal">({row.teamId})</span>
                            </td>
                            <td className={`p-3 text-right font-bold text-lg ${row.totalGameEbitdaPaise >= 0 ? 'text-green-400' : 'text-red-400'}`}>
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
    );
};

export default ControllerDashboard;

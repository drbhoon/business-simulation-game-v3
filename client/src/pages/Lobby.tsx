import React, { useEffect, useState } from 'react';
import { useSocket } from '../contexts/SocketContext';
import TeamDashboard from './TeamDashboard';

interface Team {
    id: number;
    name: string;
    baseTmCount: number;
}

interface GameState {
    phase: string;
    currentQuarter: number;
}

const Lobby: React.FC = () => {
    const socket = useSocket();
    const [teams, setTeams] = useState<Team[]>([]);
    const [teamName, setTeamName] = useState('');
    const [pin, setPin] = useState('');
    const [error, setError] = useState('');
    const [registeredTeam, setRegisteredTeam] = useState<Team | null>(null);
    const [gameState, setGameState] = useState<GameState | null>(null);

    useEffect(() => {
        if (!socket) return;

        socket.emit('get_initial_state');

        socket.on('teams_update', (updatedTeams: Team[]) => {
            setTeams(updatedTeams);
        });

        socket.on('game_state_update', (state: GameState) => {
            setGameState(state);
        });

        socket.on('registration_success', (team: Team) => {
            setRegisteredTeam(team);
            setError('');
        });

        socket.on('error_message', (msg: string) => {
            setError(msg);
        });

        socket.on('game_reset', (newState: GameState) => {
            setRegisteredTeam(null);
            setGameState(newState);
            setTeams([]);
            setTeamName('');
            setPin('');
            setError('');
        });

        return () => {
            socket.off('teams_update');
            socket.off('game_state_update');
            socket.off('registration_success');
            socket.off('error_message');
            socket.off('game_reset');
        };
    }, [socket]);

    const handleJoin = () => {
        if (!socket) return;
        socket.emit('register_team', { name: teamName, pin });
    };

    // Strict Flow: Team Dashboard only opens if registered AND (Quarter Start OR later phase)
    // If PREROLL, show specific message
    if (registeredTeam && gameState && gameState.phase === 'QUARTER_PREROLL') {
        return (
            <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center p-8">
                <div className="text-center space-y-6 animate-pulse">
                    <h1 className="text-6xl font-black text-yellow-500">GET READY!</h1>
                    <p className="text-2xl text-gray-300">Bidding is about to start...</p>
                    <div className="mt-8 p-4 bg-gray-800 rounded border border-gray-700 inline-block">
                        <p className="text-sm text-gray-400">Team: {registeredTeam.name}</p>
                    </div>
                </div>
            </div>
        );
    }

    // Use the latest team data from the 'teams' array if available
    const liveTeam = teams.find(t => t.id === registeredTeam?.id) || registeredTeam;

    // DIRECT TO DASHBOARD: Once registered, go to TeamDashboard which handles "LOBBY" phase by showing Rules.
    if (liveTeam && gameState) {
        return <TeamDashboard team={liveTeam} gameState={gameState} />;
    }

    return (
        <div className="min-h-screen bg-gray-900 text-white p-8 font-sans">
            <h1 className="text-4xl font-bold mb-8 text-center bg-gradient-to-r from-blue-400 to-purple-600 bg-clip-text text-transparent">
                RMX Business Simulation
            </h1>

            <div className="max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-8">
                {/* Registration Panel */}
                <div className="bg-gray-800 p-6 rounded-xl shadow-lg border border-gray-700">
                    <h2 className="text-2xl font-semibold mb-4 text-blue-300">Join Game</h2>
                    {registeredTeam ? (
                        <div className="text-green-400 p-6 bg-green-900/20 rounded border border-green-700/50 flex flex-col items-center justify-center h-64 text-center">
                            <div className="text-5xl mb-4">✅</div>
                            <div className="text-xl">Registered as <span className="font-bold text-white">{registeredTeam.name}</span></div>
                            <div className="mt-4 text-gray-400">
                                <p className="text-lg text-white font-semibold">Waiting for Admin to Start the Game.</p>
                                <p className="text-sm mt-2 animate-pulse text-yellow-500">Please wait...</p>
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            <div className="bg-gray-700/50 p-4 rounded text-sm text-gray-300 mb-4">
                                Enter your Team Name and PIN. If you are re-joining, use the same credentials.
                            </div>
                            <input
                                className="w-full bg-gray-700 border border-gray-600 rounded p-3 text-white focus:ring-2 focus:ring-blue-500 outline-none"
                                placeholder="Team Name"
                                value={teamName}
                                onChange={e => setTeamName(e.target.value)}
                            />
                            <input
                                className="w-full bg-gray-700 border border-gray-600 rounded p-3 text-white focus:ring-2 focus:ring-blue-500 outline-none"
                                placeholder="PIN Code (4 digits)"
                                value={pin}
                                onChange={e => setPin(e.target.value)}
                            />
                            <button
                                onClick={handleJoin}
                                className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 rounded transition-all transform hover:scale-[1.02]"
                            >
                                Register / Login
                            </button>
                            {error && <p className="text-red-400 text-sm mt-2">{error}</p>}
                        </div>
                    )}
                </div>

                {/* Lobby Status */}
                <div className="bg-gray-800 p-6 rounded-xl shadow-lg border border-gray-700">
                    <div className="flex justify-between items-center mb-4">
                        <h2 className="text-2xl font-semibold text-purple-300">Lobby Status</h2>
                        {gameState && (
                            <span className="px-3 py-1 rounded bg-gray-700 text-xs text-gray-300">
                                Phase: {gameState.phase}
                            </span>
                        )}
                    </div>

                    <div className="space-y-2 mb-6 max-h-[400px] overflow-y-auto">
                        {teams.map((t) => (
                            <div key={t.id} className="p-3 bg-gray-700/50 rounded flex justify-between items-center border-l-4 border-green-500">
                                <span className="font-medium text-gray-200">{t.name}</span>
                                <span className="text-xs text-green-400 font-bold uppercase tracking-wider">Ready</span>
                            </div>
                        ))}
                        {teams.length === 0 && <p className="text-gray-500 italic p-4 text-center">No teams joined yet. reset required?</p>}
                    </div>
                </div>
            </div>
            <div className="text-center mt-12 text-gray-600 text-xs">
                Admin? Go to <a href="/controller" className="underline hover:text-gray-400">/controller</a>
            </div>
        </div>
    );
};

export default Lobby;

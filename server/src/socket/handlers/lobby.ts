import { Server, Socket } from 'socket.io';
import * as LobbyController from '../../controllers/lobbyController';

export function handleLobbyEvents(io: Server, socket: Socket) {
    // Join Lobby (General Room)
    socket.join('lobby');

    // Get current state on connect
    socket.on('get_initial_state', async () => {
        try {
            const teams = await LobbyController.getTeams();
            const gameState = await LobbyController.getGameState();
            socket.emit('game_state_update', gameState);
            socket.emit('teams_update', teams);
        } catch (err) {
            console.error(err);
        }
    });

    // Register / Join Team
    socket.on('register_team', async (data: { name: string, pin: string }) => {
        try {
            const gameState = await LobbyController.getGameState();
            // Allow joining even if game started if it's a re-login

            try {
                // Try create
                const team = await LobbyController.createTeam(data.name, data.pin);
                io.emit('team_joined', team);
                socket.emit('registration_success', team);

                const teams = await LobbyController.getTeams();
                io.emit('teams_update', teams);
            } catch (err: any) {
                // If unique constraint violation, try LOGIN
                const existingTeam = await LobbyController.loginTeam(data.name, data.pin);
                if (existingTeam) {
                    // Success Login
                    socket.emit('registration_success', existingTeam);
                    socket.emit('game_state_update', gameState); // Ensure they get latest state
                } else {
                    // Failed login (wrong pin or other error)
                    socket.emit('error_message', 'Team name exists. Wrong PIN to join.');
                }
            }
        } catch (err) {
            console.error(err);
            socket.emit('error_message', 'Server error during registration.');
        }
    });

    // Admin: Start Game
    socket.on('admin_start_game', async (password: string) => {
        if (password !== (process.env.StartGamePassword || 'admin123')) {
            socket.emit('error_message', 'Invalid admin password');
            return;
        }

        try {
            // Logic to transition to Quarter Start
            const newState = await LobbyController.updateGamePhase('QUARTER_START');
            io.emit('game_state_update', newState);
        } catch (err) {
            console.error(err);
        }
    });

    // Admin: Set Phase (Generic)
    socket.on('admin_set_phase', async (data: { phase: string, password: string }) => {
        if (data.password !== (process.env.StartGamePassword || 'admin123')) {
            socket.emit('error_message', 'Invalid admin password');
            return;
        }
        try {
            const newState = await LobbyController.updateGamePhase(data.phase);
            io.emit('game_state_update', newState);
        } catch (err) {
            console.error(err);
        }
    });

    // Admin: Reset Game
    socket.on('admin_reset_game', async (password: string) => {
        if (password !== (process.env.StartGamePassword || 'admin123')) {
            socket.emit('error_message', 'Invalid admin password');
            return;
        }

        try {
            const newState = await LobbyController.resetGame();

            // Broadcast critical reset event
            io.emit('game_reset', newState);

            // Send empty teams list
            const teams = await LobbyController.getTeams();
            io.emit('teams_update', teams);
        } catch (err) {
            console.error(err);
        }
    });
}

import { Server, Socket } from 'socket.io';
import * as LobbyController from '../../controllers/lobbyController';

const adminPassword = () => process.env.StartGamePassword || 'admin123';

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

    // Does this player's link still belong to the game that is running?
    // Asked by the join screen so a stale link says so up front, instead of
    // letting somebody fill the form and be refused afterwards.
    socket.on('check_join_code', async (code: string) => {
        try {
            socket.emit('join_code_status', { valid: await LobbyController.joinCodeMatches(code) });
        } catch (err) {
            console.error(err);
            socket.emit('join_code_status', { valid: false });
        }
    });

    // Register / Join Team
    socket.on('register_team', async (data: { name: string, pin: string, code?: string }) => {
        try {
            // The real gate. check_join_code above is for the screen; a client
            // can skip it, so the code is verified again where it counts.
            if (!await LobbyController.joinCodeMatches(data.code)) {
                socket.emit('invalid_join_code');
                socket.emit('error_message',
                    'This game link is no longer valid. Please ask your controller for the current link.');
                return;
            }
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
                // 1. Check for specific Game Full error
                if (err.message === "Game is Full Now. Contact Controller") {
                    socket.emit('error_message', err.message);
                    return;
                }

                // 2. If unique constraint violation or "Team Name Exists", try LOGIN
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

    // Admin: the link to hand to players for the game running now.
    // Controller-only — it is emitted to the asking socket, never broadcast,
    // so it does not travel to every connected player.
    socket.on('admin_get_join_link', async (password: string) => {
        if (password !== adminPassword()) {
            socket.emit('error_message', 'Invalid admin password');
            return;
        }
        try {
            socket.emit('join_link', { code: await LobbyController.getJoinCode() });
        } catch (err) {
            console.error(err);
            socket.emit('error_message', 'Could not read the game link.');
        }
    });

    // Admin: Reset Game — ends this game, starts a clean one on a NEW link.
    socket.on('admin_reset_game', async (password: string) => {
        if (password !== adminPassword()) {
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

            // Only back to the controller: the players on the old link are
            // meant to lose access, so they must not be told the new code.
            socket.emit('join_link', { code: await LobbyController.getJoinCode() });
        } catch (err) {
            console.error(err);
        }
    });
}

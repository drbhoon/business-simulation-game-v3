import { Server, Socket } from 'socket.io';
import { handleLobbyEvents } from './handlers/lobby';
import { handleGameEvents } from './handlers/game';

export default function setupSocket(io: Server) {
    io.on('connection', (socket: Socket) => {
        console.log('Client connected:', socket.id);

        // Lobby Events
        handleLobbyEvents(io, socket);
        handleGameEvents(io, socket);

        socket.on('disconnect', () => {
            console.log('Client disconnected:', socket.id);
        });
    });
}

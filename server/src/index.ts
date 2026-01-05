import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import setupSocket from './socket';

dotenv.config({ path: path.join(__dirname, '../.env') });

console.log(`[Startup] NODE_ENV: ${process.env.NODE_ENV}`);
console.log(`[Startup] CWD: ${process.cwd()}`);

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*", // Adjust for production
        methods: ["GET", "POST"]
    }
});

// Initialize Socket.io handlers
setupSocket(io);

// Health Check
app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

// Serve static assets in production
if (process.env.NODE_ENV === 'production') {
    const clientDistPath = path.join(__dirname, '../../client/dist');
    console.log(`[Static] Serving client files from: ${clientDistPath}`);
    app.use(express.static(clientDistPath));

    // Correct Express 5 syntax for 'catch all' is often just a middleware at the end or proper regex
    // Using a named splat parameter {0,} or simply handling 404s
    // safest cross-version way for SPA fallback:
    app.get('*', (req, res) => {
        res.sendFile(path.join(clientDistPath, 'index.html'));
    });
}

const PORT = Number(process.env.PORT) || 3000;

server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
    console.log('READY_FOR_TRAFFIC'); // Signal to logs
});

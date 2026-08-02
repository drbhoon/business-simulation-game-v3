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

// On the HR platform the app is mounted at hr.rdcc.ai/simgame and nginx
// proxies the prefix through unstripped, so every route — including the
// Socket.IO handshake — has to live under it. Empty everywhere else, which
// mounts the router at "/" exactly as before.
const BASE_PATH = (process.env.BASE_PATH || '').replace(/\/$/, '');

const server = http.createServer(app);
const io = new Server(server, {
    path: `${BASE_PATH}/socket.io`,
    cors: {
        origin: "*", // Adjust for production
        methods: ["GET", "POST"]
    }
});

// Initialize Socket.io handlers
setupSocket(io);

const router = express.Router();

// Health Check
router.get('/health', (req, res) => {
    res.status(200).send('OK');
});

// Serve static assets in production
if (process.env.NODE_ENV === 'production') {
    const clientDistPath = path.join(__dirname, '../../client/dist');
    console.log(`[Static] Serving client files from: ${clientDistPath}`);
    router.use(express.static(clientDistPath));

    // Correct Express 5 syntax for 'catch all' is often just a middleware at the end or proper regex
    // Using a named splat parameter {0,} or simply handling 404s
    // safest cross-version way for SPA fallback:
    router.get('*', (req, res) => {
        res.sendFile(path.join(clientDistPath, 'index.html'));
    });
}

app.use(BASE_PATH || '/', router);

const PORT = Number(process.env.PORT) || 3000;

server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
    console.log('READY_FOR_TRAFFIC'); // Signal to logs
});

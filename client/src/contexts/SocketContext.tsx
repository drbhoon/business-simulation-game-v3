import React, { createContext, useContext, useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { withBase } from '../basePath';

const SocketContext = createContext<Socket | null>(null);

export const useSocket = () => {
    return useContext(SocketContext);
};

export const SocketProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [socket, setSocket] = useState<Socket | null>(null);

    useEffect(() => {
        // Use relative URL in production (served by same host)
        // Use hardcoded localhost:3000 in development
        const socketUrl = import.meta.env.PROD ? undefined : 'http://localhost:3000';

        // Under a mount prefix the handshake has to go to <prefix>/socket.io —
        // the server is configured with the same path. withBase() is a no-op
        // when the app is served from the root.
        const newSocket = io(socketUrl, { path: withBase('/socket.io') });
        setSocket(newSocket);

        return () => {
            newSocket.disconnect();
        };
    }, []);

    return (
        <SocketContext.Provider value={socket}>
            {children}
        </SocketContext.Provider>
    );
};

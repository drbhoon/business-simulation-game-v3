import React, { useEffect, useRef, useState } from 'react';
import { useSocket } from '../contexts/SocketContext';

// Royalty Free "Airport Lounge" or similar soothing music
// Source: Local or standard public domain
// Using a placeholder URL that is known to work for "Lounge" or allow user to replace 
// We will use a reliable remote URL for demo purposes. 
// "Airport Lounge" by Kevin MacLeod (incompetech.com)
// Licensed under Creative Commons: By Attribution 3.0 License
const MUSIC_URL = 'https://incompetech.com/music/royalty-free/mp3-royaltyfree/Airport%20Lounge.mp3';

const BackgroundMusic: React.FC = () => {
    const socket = useSocket();
    const [shouldPlay, setShouldPlay] = useState(false);
    const audioRef = useRef<HTMLAudioElement | null>(null);

    useEffect(() => {
        if (!socket) return;

        // On Mount, get state to check phase
        socket.on('game_state_update', (state) => {
            // Play ONLY in LOBBY phase
            if (state.phase === 'LOBBY' || state.phase === 'QUARTER_PREROLL') {
                setShouldPlay(true);
            } else {
                setShouldPlay(false);
            }
        });

        return () => {
            socket.off('game_state_update');
        };
    }, [socket]);

    useEffect(() => {
        if (!audioRef.current) return;

        if (shouldPlay) {
            audioRef.current.volume = 0.3; // Soft volume
            const playPromise = audioRef.current.play();
            if (playPromise !== undefined) {
                playPromise.catch(() => {
                    // Auto-play prevented
                    console.log("Audio autoplay prevented. User interaction needed.");
                });
            }
        } else {
            audioRef.current.pause();
        }
    }, [shouldPlay]);

    return (
        <audio ref={audioRef} loop>
            <source src={MUSIC_URL} type="audio/mpeg" />
        </audio>
    );
};

export default BackgroundMusic;

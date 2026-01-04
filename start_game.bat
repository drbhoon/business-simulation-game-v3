@echo off
echo Starting Business Simulation Game...
echo -----------------------------------
echo 1. Starting Server (Port 3000)...
start "Game Server" cmd /k "cd server && npm run dev"
timeout /t 5
echo 2. Starting Client (Port 5173)...
start "Game Client" cmd /k "cd client && npm run dev"
echo -----------------------------------
echo Done! Please wait for the windows to initialize.
pause

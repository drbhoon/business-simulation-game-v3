import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Lobby from './pages/Lobby';
import ControllerDashboard from './pages/ControllerDashboard';
import { SocketProvider } from './contexts/SocketContext';

import BackgroundMusic from './components/BackgroundMusic';

function App() {
  return (
    <Router>
      <SocketProvider>
        <div className="min-h-screen bg-gray-900 relative">
          {/* LOGO - Top Left Fixed */}
          <div className="fixed top-4 left-4 z-50">
            <img
              src="/rdc_logo.png"
              alt="RDC Logo"
              className="h-16 w-auto object-contain drop-shadow-lg"
            />
          </div>

          {/* MUSIC PLAYER */}
          <BackgroundMusic />

          <Routes>
            <Route path="/" element={<Lobby />} />
            <Route path="/controller" element={<ControllerDashboard />} />
          </Routes>
        </div>
      </SocketProvider>
    </Router>
  );
}

export default App;

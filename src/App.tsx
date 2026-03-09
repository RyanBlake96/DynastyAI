import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Landing from './pages/Landing';
import LeagueLayout from './components/LeagueLayout';
import Dashboard from './pages/Dashboard';
import TeamDetail from './pages/TeamDetail';
import PlayerDetail from './pages/PlayerDetail';
import TradeFinder from './pages/TradeFinder';
import TradeEvaluator from './pages/TradeEvaluator';
import RookieDraft from './pages/RookieDraft';
import Transactions from './pages/Transactions';
import LeagueRankings from './pages/LeagueRankings';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/league/:leagueId" element={<LeagueLayout />}>
          <Route index element={<Dashboard />} />
          <Route path="team/:rosterId" element={<TeamDetail />} />
          <Route path="trades" element={<TradeFinder />} />
          <Route path="trade-eval" element={<TradeEvaluator />} />
          <Route path="draft" element={<RookieDraft />} />
          <Route path="transactions" element={<Transactions />} />
          <Route path="player/:playerId" element={<PlayerDetail />} />
          <Route path="rankings" element={<LeagueRankings />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

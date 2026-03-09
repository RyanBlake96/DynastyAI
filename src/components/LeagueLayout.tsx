import { NavLink, Outlet, Link, useParams, useOutletContext, useLocation } from 'react-router-dom';
import { useLeagueData } from '../hooks/useLeagueData';
import type { LeagueContext } from '../types';
import ThemeToggle from './ThemeToggle';

export interface LeagueLayoutContext {
  data: LeagueContext;
  leagueId: string;
  refresh: () => void;
  refreshing: boolean;
}

export function useLeagueLayout() {
  return useOutletContext<LeagueLayoutContext>();
}

interface NavLinkItem {
  to: string;
  label: string;
  end?: boolean;
  alsoActive?: string[];
}

function NavLinks({ navLinks }: { navLinks: NavLinkItem[] }) {
  const location = useLocation();
  return (
    <nav className="flex gap-3 max-w-6xl mx-auto mt-3 text-sm">
      {navLinks.map(({ to, label, end, alsoActive }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) => {
            const active = isActive || (alsoActive?.some(p => location.pathname.startsWith(p)) ?? false);
            return `px-3 py-1.5 rounded-full border transition-colors ${
              active
                ? 'bg-gray-900 text-white border-gray-900 dark:bg-gray-100 dark:text-gray-900 dark:border-gray-100'
                : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-600 dark:hover:border-gray-400'
            }`;
          }}
        >
          {label}
        </NavLink>
      ))}
    </nav>
  );
}

export default function LeagueLayout() {
  const { leagueId } = useParams<{ leagueId: string }>();
  const { data, status, error, refresh, refreshing } = useLeagueData(leagueId);

  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <p className="text-gray-500 dark:text-gray-400">Loading league data...</p>
      </div>
    );
  }

  if (status === 'error' || !data) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col items-center justify-center gap-4">
        <p className="text-red-600 dark:text-red-400">{error || 'Failed to load league'}</p>
        <Link to="/" className="text-blue-600 dark:text-blue-400 hover:underline text-sm">Back to home</Link>
      </div>
    );
  }

  const { league } = data;

  const navLinks = [
    { to: `/league/${leagueId}`, label: 'Dashboard', end: true },
    { to: `/league/${leagueId}/rankings`, label: 'Player Rankings' },
    { to: `/league/${leagueId}/transactions`, label: 'Transactions' },
    { to: `/league/${leagueId}/trades`, label: 'Trade Tools', alsoActive: [`/league/${leagueId}/trade-eval`] },
    { to: `/league/${leagueId}/draft`, label: 'Rookie Draft' },
  ];

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-8 py-4">
        <div className="flex items-center justify-between max-w-6xl mx-auto">
          <div>
            <Link to="/" className="text-sm text-blue-600 dark:text-blue-400 hover:underline">
              &larr; Home
            </Link>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mt-1">{league.name}</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {league.season} &middot; {league.total_rosters} teams &middot;{' '}
              {data.leagueType === 'superflex' ? 'Superflex' : '1QB'}
              {league.scoring_settings?.rec === 0.5 ? ' · Half PPR' : ''}
              {league.scoring_settings?.rec === 1 ? ' · PPR' : ''}
              {league.scoring_settings?.bonus_rec_te && league.scoring_settings.bonus_rec_te > 0
                ? ` · TE Premium (+${league.scoring_settings.bonus_rec_te})`
                : ''}
            </p>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <button
              onClick={refresh}
              disabled={refreshing}
              className="text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 disabled:opacity-50"
              title="Re-sync league data"
            >
              {refreshing ? 'Syncing...' : 'Re-sync'}
            </button>
            <ThemeToggle />
          </div>
        </div>
        <NavLinks navLinks={navLinks} />
      </header>

      <Outlet context={{ data, leagueId: leagueId!, refresh, refreshing } satisfies LeagueLayoutContext} />
    </div>
  );
}

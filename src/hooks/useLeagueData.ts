import { useState, useEffect, useCallback } from 'react';
import { fetchLeague, fetchRosters, fetchLeagueUsers } from '../api/sleeper';
import { detectLeagueType } from '../utils/leagueType';
import type { LeagueContext } from '../types';

type Status = 'loading' | 'ready' | 'error';

export function useLeagueData(leagueId: string | undefined) {
  const [data, setData] = useState<LeagueContext | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!leagueId) {
      setStatus('error');
      setError('No league ID provided');
      return;
    }

    let cancelled = false;
    const isRefresh = refreshKey > 0;

    async function load() {
      if (isRefresh) {
        setRefreshing(true);
      } else {
        setStatus('loading');
      }
      setError('');

      // Cache-bust param forces Vercel edge to re-fetch from Sleeper
      const bustCache = isRefresh ? `&_t=${Date.now()}` : '';

      try {
        const [league, rosters, users] = await Promise.all([
          fetchLeague(leagueId!, bustCache),
          fetchRosters(leagueId!, bustCache),
          fetchLeagueUsers(leagueId!, bustCache),
        ]);

        if (cancelled) return;

        setData({
          league,
          rosters,
          users,
          leagueType: detectLeagueType(league),
        });
        setStatus('ready');
      } catch (err) {
        if (cancelled) return;
        setStatus('error');
        setError(err instanceof Error ? err.message : 'Failed to load league data');
      } finally {
        if (!cancelled) setRefreshing(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [leagueId, refreshKey]);

  const refresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  return { data, status, error, refresh, refreshing };
}

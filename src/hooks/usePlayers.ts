import { useState, useEffect } from 'react';
import { fetchPlayers } from '../api/sleeper';
import type { SleeperPlayer } from '../types';

type PlayersMap = Record<string, SleeperPlayer>;
type Status = 'loading' | 'ready' | 'error';

// Module-level cache so we only fetch once across all components
let cachedPlayers: PlayersMap | null = null;
let fetchPromise: Promise<PlayersMap> | null = null;

function loadPlayers(): Promise<PlayersMap> {
  if (cachedPlayers) return Promise.resolve(cachedPlayers);
  if (fetchPromise) return fetchPromise;

  fetchPromise = fetchPlayers().then((data: PlayersMap) => {
    cachedPlayers = data;
    return data;
  });

  return fetchPromise;
}

export function usePlayers() {
  const [players, setPlayers] = useState<PlayersMap | null>(cachedPlayers);
  const [status, setStatus] = useState<Status>(cachedPlayers ? 'ready' : 'loading');

  useEffect(() => {
    if (cachedPlayers) {
      setPlayers(cachedPlayers);
      setStatus('ready');
      return;
    }

    let cancelled = false;

    loadPlayers()
      .then((data) => {
        if (!cancelled) {
          setPlayers(data);
          setStatus('ready');
        }
      })
      .catch(() => {
        if (!cancelled) setStatus('error');
      });

    return () => { cancelled = true; };
  }, []);

  return { players, status };
}

export function getPlayerName(players: PlayersMap | null, playerId: string): string {
  if (!players || !players[playerId]) return playerId;
  const p = players[playerId];
  return p.full_name || `${p.first_name} ${p.last_name}`;
}

export function getPlayerInfo(players: PlayersMap | null, playerId: string) {
  if (!players || !players[playerId]) {
    return { name: playerId, position: '??', team: null, age: null };
  }
  const p = players[playerId];
  return {
    name: p.full_name || `${p.first_name} ${p.last_name}`,
    position: p.position || '??',
    team: p.team,
    age: p.age,
  };
}

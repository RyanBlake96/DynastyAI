import { useState, useEffect } from 'react';
import { fetchPlayerValues } from '../api/values';
import type { ValuesResponse } from '../api/values';
import type { LeagueType } from '../types';
import {
  computeNormalizationStats,
  getNormalizedPlayerValue,
  getNormalizedBreakdown,
} from '../utils/normalizeValues';
import type { NormalizedValues } from '../utils/normalizeValues';

type Status = 'loading' | 'ready' | 'error';

// Module-level cache keyed by league type
const cache = new Map<LeagueType, ValuesResponse>();
const normCache = new Map<LeagueType, NormalizedValues>();

export function usePlayerValues(leagueType: LeagueType | undefined) {
  const [data, setData] = useState<ValuesResponse | null>(
    leagueType ? cache.get(leagueType) ?? null : null,
  );
  const [status, setStatus] = useState<Status>(
    leagueType && cache.has(leagueType) ? 'ready' : 'loading',
  );

  useEffect(() => {
    if (!leagueType) return;

    if (cache.has(leagueType)) {
      setData(cache.get(leagueType)!);
      setStatus('ready');
      return;
    }

    let cancelled = false;

    fetchPlayerValues(leagueType)
      .then((res) => {
        if (cancelled) return;
        cache.set(leagueType, res);
        normCache.set(leagueType, computeNormalizationStats(res));
        setData(res);
        setStatus('ready');
      })
      .catch(() => {
        if (!cancelled) setStatus('error');
      });

    return () => { cancelled = true; };
  }, [leagueType]);

  return { values: data, status };
}

// Get normalization stats for a given values response
function getNormalized(values: ValuesResponse): NormalizedValues {
  // Check cache by iterating (values object identity)
  for (const [, nv] of normCache) {
    if (nv.sources === values.sources) return nv;
  }
  // Compute on the fly if not cached (shouldn't normally happen)
  const nv = computeNormalizationStats(values);
  return nv;
}

// Get a player's normalized average value across available sources (0-10000 scale)
export function getPlayerValue(
  values: ValuesResponse | null,
  playerId: string,
): number {
  if (!values) return 0;
  const nv = getNormalized(values);
  return getNormalizedPlayerValue(nv, playerId);
}

// Get individual normalized source values for a player
export function getPlayerValueBreakdown(
  values: ValuesResponse | null,
  playerId: string,
): { ktc: number; fantasycalc: number; dynastyprocess: number; average: number; rawKtc: number; rawFantasycalc: number; rawDynastyprocess: number } {
  if (!values) return { ktc: 0, fantasycalc: 0, dynastyprocess: 0, average: 0, rawKtc: 0, rawFantasycalc: 0, rawDynastyprocess: 0 };
  const nv = getNormalized(values);
  return getNormalizedBreakdown(nv, playerId);
}

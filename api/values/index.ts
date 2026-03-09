import type { VercelRequest, VercelResponse } from '@vercel/node';
import { redis, CACHE_KEYS } from '../_lib/redis.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const leagueType = (req.query.type as string) || '1qb';

  if (leagueType !== '1qb' && leagueType !== 'sf') {
    return res.status(400).json({ error: 'Type must be "1qb" or "sf"' });
  }

  try {
    const ktcKey = leagueType === 'sf' ? CACHE_KEYS.KTC_SF : CACHE_KEYS.KTC_1QB;
    const fcKey = leagueType === 'sf' ? CACHE_KEYS.FANTASYCALC_SF : CACHE_KEYS.FANTASYCALC_1QB;
    const dpKey = leagueType === 'sf' ? CACHE_KEYS.DYNASTYPROCESS_SF : CACHE_KEYS.DYNASTYPROCESS_1QB;

    const [ktc, fantasycalc, dynastyprocess, lastRefresh] = await Promise.all([
      redis.get(ktcKey),
      redis.get(fcKey),
      redis.get(dpKey),
      redis.get(CACHE_KEYS.LAST_REFRESH),
    ]);

    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=7200');
    return res.status(200).json({
      leagueType,
      lastRefresh,
      sources: {
        ktc: ktc || null,
        fantasycalc: fantasycalc || null,
        dynastyprocess: dynastyprocess || null,
      },
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch player values from cache' });
  }
}

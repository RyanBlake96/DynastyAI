import type { VercelRequest, VercelResponse } from '@vercel/node';

const SLEEPER_BASE = 'https://api.sleeper.app/v1';

// GET /api/sleeper/state?sport=nfl
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const sport = (req.query.sport as string) || 'nfl';

  try {
    const response = await fetch(`${SLEEPER_BASE}/state/${sport}`);

    if (!response.ok) {
      return res.status(response.status).json({ error: `Sleeper API returned ${response.status}` });
    }

    const data = await response.json();
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=7200');
    return res.status(200).json(data);
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch NFL state from Sleeper' });
  }
}

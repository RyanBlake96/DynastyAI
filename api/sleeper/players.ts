import type { VercelRequest, VercelResponse } from '@vercel/node';

const SLEEPER_BASE = 'https://api.sleeper.app/v1';

// GET /api/sleeper/players
export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const response = await fetch(`${SLEEPER_BASE}/players/nfl`);

    if (!response.ok) {
      return res.status(response.status).json({ error: 'Failed to fetch players' });
    }

    const data = await response.json();
    res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=172800');
    return res.status(200).json(data);
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch players from Sleeper' });
  }
}

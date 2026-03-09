import type { VercelRequest, VercelResponse } from '@vercel/node';

const SLEEPER_BASE = 'https://api.sleeper.app/v1';

// GET /api/sleeper/user?id=<username_or_id>
// GET /api/sleeper/user?id=<user_id>&resource=leagues&sport=nfl&season=2025
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const id = req.query.id as string;
  const resource = req.query.resource as string | undefined;

  if (!id) {
    return res.status(400).json({ error: 'id parameter is required' });
  }

  let url: string;

  if (resource === 'leagues') {
    const sport = (req.query.sport as string) || 'nfl';
    const season = (req.query.season as string) || '2025';
    url = `${SLEEPER_BASE}/user/${id}/leagues/${sport}/${season}`;
  } else {
    url = `${SLEEPER_BASE}/user/${id}`;
  }

  try {
    const response = await fetch(url);

    if (!response.ok) {
      return res.status(response.status).json({ error: `Sleeper API returned ${response.status}` });
    }

    const data = await response.json();
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    return res.status(200).json(data);
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch from Sleeper API' });
  }
}

import type { VercelRequest, VercelResponse } from '@vercel/node';

const SLEEPER_BASE = 'https://api.sleeper.app/v1';

// GET /api/sleeper/league?id=<league_id>
// GET /api/sleeper/league?id=<league_id>&resource=rosters|users|drafts|transactions|traded_picks
// GET /api/sleeper/league?id=<league_id>&resource=matchups&week=1
// GET /api/sleeper/league?id=<league_id>&resource=transactions&round=1
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const id = req.query.id as string;
  const resource = req.query.resource as string | undefined;

  if (!id) {
    return res.status(400).json({ error: 'id parameter is required' });
  }

  let url: string;
  let cacheControl = 's-maxage=300, stale-while-revalidate=600';

  if (!resource) {
    url = `${SLEEPER_BASE}/league/${id}`;
  } else {
    switch (resource) {
      case 'rosters':
        url = `${SLEEPER_BASE}/league/${id}/rosters`;
        cacheControl = 's-maxage=60, stale-while-revalidate=120';
        break;
      case 'users':
        url = `${SLEEPER_BASE}/league/${id}/users`;
        break;
      case 'drafts':
        url = `${SLEEPER_BASE}/league/${id}/drafts`;
        break;
      case 'transactions': {
        const round = (req.query.round as string) || '1';
        url = `${SLEEPER_BASE}/league/${id}/transactions/${round}`;
        cacheControl = 's-maxage=60, stale-while-revalidate=120';
        break;
      }
      case 'matchups': {
        const week = req.query.week as string;
        if (!week) {
          return res.status(400).json({ error: 'week parameter is required for matchups' });
        }
        url = `${SLEEPER_BASE}/league/${id}/matchups/${week}`;
        cacheControl = 's-maxage=60, stale-while-revalidate=120';
        break;
      }
      case 'traded_picks':
        url = `${SLEEPER_BASE}/league/${id}/traded_picks`;
        break;
      case 'draft_picks': {
        const draftId = req.query.draft_id as string;
        if (!draftId) {
          return res.status(400).json({ error: 'draft_id parameter is required for draft_picks' });
        }
        url = `${SLEEPER_BASE}/draft/${draftId}/picks`;
        cacheControl = 's-maxage=300, stale-while-revalidate=600';
        break;
      }
      default:
        return res.status(400).json({ error: `Unknown resource: ${resource}` });
    }
  }

  try {
    const response = await fetch(url);

    if (!response.ok) {
      return res.status(response.status).json({ error: `Sleeper API returned ${response.status}` });
    }

    const data = await response.json();
    res.setHeader('Cache-Control', cacheControl);
    return res.status(200).json(data);
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch from Sleeper API' });
  }
}

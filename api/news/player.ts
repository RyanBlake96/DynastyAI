import type { VercelRequest, VercelResponse } from '@vercel/node';

// GET /api/news/player?name=Patrick+Mahomes
// Returns recent NFL news articles for a player via ESPN's public API
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const name = req.query.name as string;

  if (!name) {
    return res.status(400).json({ error: 'name parameter is required' });
  }

  try {
    // Step 1: Search ESPN for the athlete ID
    const searchUrl = `https://site.api.espn.com/apis/common/v3/search?query=${encodeURIComponent(name)}&type=player&sport=football&limit=1`;
    const searchRes = await fetch(searchUrl);

    if (!searchRes.ok) {
      return res.status(502).json({ error: 'ESPN search failed' });
    }

    const searchData = await searchRes.json();
    const firstResult = searchData?.items?.[0];

    if (!firstResult) {
      res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=7200');
      return res.status(200).json({ news: [] });
    }

    // ESPN search returns athlete ID directly on the item, or nested in links
    const athleteId = firstResult.id
      || (firstResult.links?.api?.athletes?.href || firstResult.$ref || '').match(/athletes\/(\d+)/)?.[1];

    if (!athleteId) {
      res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=7200');
      return res.status(200).json({ news: [] });
    }

    // Step 2: Fetch news for this athlete
    const newsUrl = `https://site.api.espn.com/apis/fantasy/v2/games/ffl/news/players?playerId=${athleteId}&limit=5`;
    const newsRes = await fetch(newsUrl);

    if (!newsRes.ok) {
      res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
      return res.status(200).json({ news: [] });
    }

    const newsData = await newsRes.json();
    const articles = newsData?.feed || [];

    const news = articles.map((item: any) => ({
      headline: item.headline || '',
      description: item.description || '',
      published: item.published || '',
      source: item.byline || 'ESPN',
      url: item.links?.web?.href || item.links?.mobile?.href || '',
    })).filter((item: any) => item.headline);

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    return res.status(200).json({ news });
  } catch {
    return res.status(500).json({ error: 'Failed to fetch player news' });
  }
}

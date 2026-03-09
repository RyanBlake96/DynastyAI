import type { NewsItem } from '../types';

export async function fetchPlayerNews(playerName: string): Promise<NewsItem[]> {
  try {
    const res = await fetch(`/api/news/player?name=${encodeURIComponent(playerName)}`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.news || [];
  } catch {
    return [];
  }
}

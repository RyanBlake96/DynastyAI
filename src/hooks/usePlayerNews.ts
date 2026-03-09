import { useState, useEffect } from 'react';
import type { NewsItem } from '../types';
import { fetchPlayerNews } from '../api/news';

interface UsePlayerNewsResult {
  news: NewsItem[];
  status: 'loading' | 'ready' | 'error';
}

export function usePlayerNews(playerName: string | null): UsePlayerNewsResult {
  const [news, setNews] = useState<NewsItem[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    if (!playerName) {
      setNews([]);
      setStatus('ready');
      return;
    }

    let cancelled = false;
    setStatus('loading');

    fetchPlayerNews(playerName).then(items => {
      if (!cancelled) {
        setNews(items);
        setStatus('ready');
      }
    }).catch(() => {
      if (!cancelled) {
        setNews([]);
        setStatus('error');
      }
    });

    return () => { cancelled = true; };
  }, [playerName]);

  return { news, status };
}

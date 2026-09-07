```js
import 'dotenv/config';
import Parser from 'rss-parser';
import { supabase } from './supabase.js';

const parser = new Parser({
  timeout: 15000,
  headers: {
    'User-Agent': 'BeritaMudaIndonesia/1.0 RSS Reader'
  }
});

const feeds = (process.env.RSS_FEEDS || '')
  .split(',')
  .map(x => x.trim())
  .filter(Boolean);

const categoryFor = (url, title = '') => {
  const s = `${url} ${title}`.toLowerCase();

  const categories = {
    politik: 'POLITIK',
    hukum: 'HUKUM',
    ekonomi: 'EKONOMI',
    teknologi: 'TEKNOLOGI',
    olahraga: 'OLAHRAGA',
    internasional: 'INTERNASIONAL',
    hiburan: 'HIBURAN',
    lifestyle: 'LIFESTYLE'
  };

  for (const [key, value] of Object.entries(categories)) {
    if (s.includes(key)) return value;
  }

  return 'NASIONAL';
};

export async function syncFeeds() {
  let feedsProcessed = 0;
  let feedsFailed = 0;
  let rowsSeen = 0;
  let rowsInserted = 0;

  console.log(`[SYNC] Starting. feeds=${feeds.length}`);

  for (const url of feeds) {
    try {
      console.log(`[SYNC] Reading: ${url}`);

      const feed = await parser.parseURL(url);

      feedsProcessed++;

      const rows = (feed.items || [])
        .slice(0, 50)
        .map(item => ({
          title: (item.title || '').trim(),

          summary: (
            item.contentSnippet ||
            item.content ||
            item.summary ||
            ''
          )
            .replace(/<[^>]*>/g, '')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 500),

          url: item.link,

          source: (feed.title || 'RSS')
            .toString()
            .slice(0, 120),

          category: categoryFor(url, item.title),

          image_url:
            item.enclosure?.url ||
            item['media:content']?.url ||
            item['media:thumbnail']?.url ||
            null,

          published_at:
            item.isoDate ||
            item.pubDate ||
            new Date().toISOString(),

          status: 'published'
        }))
        .filter(item => item.title && item.url);

      rowsSeen += rows.length;

      if (!rows.length) {
        console.log(`[SYNC] No articles: ${url}`);
        continue;
      }

      const { error } = await supabase
        .from('articles')
        .upsert(rows, {
          onConflict: 'url',
          ignoreDuplicates: true
        });

      if (error) {
        feedsFailed++;
        console.error(
          `[SYNC] Database error: ${url}`,
          error.message
        );
        continue;
      }

      rowsInserted += rows.length;

      console.log(
        `[SYNC] OK: ${url} articles=${rows.length}`
      );

    } catch (error) {
      feedsFailed++;

      console.error(
        `[SYNC] RSS skipped: ${url}`,
        error?.message || error
      );

      // Jangan hentikan seluruh proses.
      continue;
    }
  }

  const result = {
    ok: true,
    feeds: feeds.length,
    feedsProcessed,
    feedsFailed,
    rowsSeen,
    rowsInserted
  };

  console.log('[SYNC] Finished:', JSON.stringify(result));

  return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await syncFeeds();
}
```

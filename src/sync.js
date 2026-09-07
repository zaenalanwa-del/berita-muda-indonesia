```javascript
import 'dotenv/config';
import Parser from 'rss-parser';
import { supabase } from './supabase.js';

const parser = new Parser({
  timeout: 15000,
  headers: {
    'User-Agent': 'BeritaMudaIndonesia/1.0'
  }
});

const feeds = (process.env.RSS_FEEDS || '')
  .split(',')
  .map(function (x) {
    return x.trim();
  })
  .filter(Boolean);

function categoryFor(url, title) {
  const text = (url + ' ' + (title || '')).toLowerCase();

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

  for (const key of Object.keys(categories)) {
    if (text.includes(key)) {
      return categories[key];
    }
  }

  return 'NASIONAL';
}

export async function syncFeeds() {
  let feedsProcessed = 0;
  let feedsFailed = 0;
  let rowsSeen = 0;
  let rowsInserted = 0;

  console.log('[SYNC] Starting. feeds=' + feeds.length);

  for (const url of feeds) {
    try {
      console.log('[SYNC] Reading: ' + url);

      const feed = await parser.parseURL(url);

      feedsProcessed++;

      const rows = (feed.items || [])
        .slice(0, 50)
        .map(function (item) {
          const summary = (
            item.contentSnippet ||
            item.content ||
            item.summary ||
            ''
          )
            .replace(/<[^>]*>/g, '')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 500);

          return {
            title: (item.title || '').trim(),
            summary: summary,
            url: item.link,
            source: String(feed.title || 'RSS').slice(0, 120),
            category: categoryFor(url, item.title),
            image_url:
              (item.enclosure && item.enclosure.url) ||
              (item['media:content'] && item['media:content'].url) ||
              (item['media:thumbnail'] && item['media:thumbnail'].url) ||
              null,
            published_at:
              item.isoDate ||
              item.pubDate ||
              new Date().toISOString(),
            status: 'published'
          };
        })
        .filter(function (item) {
          return item.title && item.url;
        });

      rowsSeen += rows.length;

      if (rows.length === 0) {
        console.log('[SYNC] No articles: ' + url);
        continue;
      }

      const result = await supabase
        .from('articles')
        .upsert(rows, {
          onConflict: 'url',
          ignoreDuplicates: true
        });

      if (result.error) {
        feedsFailed++;

        console.error(
          '[SYNC] Database error: ' +
            url +
            ' - ' +
            result.error.message
        );

        continue;
      }

      rowsInserted += rows.length;

      console.log(
        '[SYNC] OK: ' +
          url +
          ' articles=' +
          rows.length
      );

    } catch (error) {
      feedsFailed++;

      console.error(
        '[SYNC] RSS skipped: ' +
          url +
          ' - ' +
          (error && error.message
            ? error.message
            : error)
      );

      continue;
    }
  }

  const result = {
    ok: true,
    feeds: feeds.length,
    feedsProcessed: feedsProcessed,
    feedsFailed: feedsFailed,
    rowsSeen: rowsSeen,
    rowsInserted: rowsInserted
  };

  console.log(
    '[SYNC] Finished: ' +
      JSON.stringify(result)
  );

  return result;
}

if (
  import.meta.url ===
  'file://' + process.argv[1]
) {
  await syncFeeds();
}
```

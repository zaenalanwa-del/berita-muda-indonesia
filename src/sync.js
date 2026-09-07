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
  .map(x => x.trim())
  .filter(Boolean);

function categoryFor(url, title = '') {
  const text = (url + ' ' + title).toLowerCase();

  if (text.includes('politik')) return 'POLITIK';
  if (text.includes('hukum')) return 'HUKUM';
  if (text.includes('ekonomi')) return 'EKONOMI';
  if (text.includes('teknologi')) return 'TEKNOLOGI';
  if (text.includes('olahraga')) return 'OLAHRAGA';
  if (text.includes('internasional')) return 'INTERNASIONAL';
  if (text.includes('hiburan')) return 'HIBURAN';
  if (text.includes('lifestyle')) return 'LIFESTYLE';

  return 'NASIONAL';
}

/*
 * PENTING:
 * server.js membutuhkan export bernama "syncFeeds".
 */
export async function syncFeeds() {
  let feedsProcessed = 0;
  let feedsFailed = 0;
  let rowsSeen = 0;

  console.log('[SYNC] START feeds=' + feeds.length);

  for (const url of feeds) {
    try {
      console.log('[SYNC] Reading ' + url);

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

          source: String(
            feed.title || 'RSS'
          ).slice(0, 120),

          category: categoryFor(
            url,
            item.title || ''
          ),

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

      if (rows.length === 0) {
        console.log('[SYNC] Empty feed ' + url);
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
          '[SYNC] Database error ' +
          url +
          ': ' +
          error.message
        );
        continue;
      }

      console.log(
        '[SYNC] OK ' +
        url +
        ' articles=' +
        rows.length
      );

    } catch (error) {
      feedsFailed++;

      console.error(
        '[SYNC] RSS failed ' +
        url +
        ': ' +
        (error?.message || error)
      );

      // Feed bermasalah tidak menghentikan feed lainnya.
      continue;
    }
  }

  const result = {
    ok: true,
    feeds: feeds.length,
    feedsProcessed,
    feedsFailed,
    rowsSeen
  };

  console.log(
    '[SYNC] FINISHED ' +
    JSON.stringify(result)
  );

  return result;
}
```

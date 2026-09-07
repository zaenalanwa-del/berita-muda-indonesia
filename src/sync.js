import 'dotenv/config';
import Parser from 'rss-parser';
import { supabase } from './supabase.js';

const parser = new Parser({
  timeout: 8000
});

const feeds = [
  'https://www.cnnindonesia.com/nasional/rss',
  'https://www.cnnindonesia.com/internasional/rss',
  'https://www.cnnindonesia.com/ekonomi/rss',
  'https://www.cnnindonesia.com/teknologi/rss',
  'https://www.cnnindonesia.com/politik/rss',
  'https://www.cnnindonesia.com/hukum/rss',
  'https://news.detik.com/berita/rss',
  'https://news.detik.com/internasional/rss',
  'https://finance.detik.com/rss',
  'https://inet.detik.com/rss',
  'https://tekno.kompas.com/rss',
  'https://nasional.kompas.com/rss',
  'https://internasional.kompas.com/rss'
];

function cleanText(value = '') {
  return String(value)
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getCategory(title = '', url = '') {
  const text = `${title} ${url}`.toLowerCase();

  if (
    text.includes('politik')
  ) return 'Politik';

  if (
    text.includes('hukum') ||
    text.includes('polisi') ||
    text.includes('korupsi')
  ) return 'Hukum';

  if (
    text.includes('ekonomi') ||
    text.includes('bisnis') ||
    text.includes('finance')
  ) return 'Ekonomi';

  if (
    text.includes('teknologi') ||
    text.includes('tech') ||
    text.includes('gadget')
  ) return 'Teknologi';

  if (
    text.includes('internasional') ||
    text.includes('world')
  ) return 'Internasional';

  return 'Nasional';
}

async function processFeed(url) {
  let inserted = 0;
  let updated = 0;
  let failed = 0;

  try {
    console.log(`Membaca feed: ${url}`);

    const feed = await parser.parseURL(url);

    const items = (feed.items || []).slice(0, 10);

    for (const item of items) {
      try {
        const title = cleanText(item.title);

        if (!title) continue;

        const articleUrl =
          item.link ||
          item.guid ||
          '';

        if (!articleUrl) continue;

        const description = cleanText(
          item.contentSnippet ||
          item.content ||
          item.summary ||
          ''
        );

        const publishedAt =
          item.isoDate ||
          item.pubDate ||
          new Date().toISOString();

        const category = getCategory(
          title,
          articleUrl
        );

        const article = {
          title,
          url: articleUrl,
          description,
          category,
          published_at: publishedAt,
          source: feed.title || 'Berita Muda Indonesia',
          image_url:
            item.enclosure?.url ||
            item['media:content']?.url ||
            null
        };

        const { data: existing, error: findError } =
          await supabase
            .from('articles')
            .select('id')
            .eq('url', articleUrl)
            .maybeSingle();

        if (findError) {
          console.error(
            'Gagal mencari artikel:',
            findError.message
          );
          failed++;
          continue;
        }

        if (existing?.id) {
          const { error } = await supabase
            .from('articles')
            .update(article)
            .eq('id', existing.id);

          if (error) {
            console.error(
              'Gagal update:',
              error.message
            );
            failed++;
          } else {
            updated++;
          }
        } else {
          const { error } = await supabase
            .from('articles')
            .insert(article);

          if (error) {
            console.error(
              'Gagal insert:',
              error.message
            );
            failed++;
          } else {
            inserted++;
          }
        }
      } catch (error) {
        console.error(
          'Gagal memproses artikel:',
          error.message
        );
        failed++;
      }
    }

    return {
      inserted,
      updated,
      failed
    };

  } catch (error) {
    console.error(
      `Gagal membaca feed: ${url}`,
      error.message
    );

    return {
      inserted,
      updated,
      failed: failed + 1
    };
  }
}

export async function syncFeeds() {
  let inserted = 0;
  let updated = 0;
  let failed = 0;

  console.log(
    `Memulai sinkronisasi ${feeds.length} feed...`
  );

  for (const url of feeds) {
    const result = await processFeed(url);

    inserted += result.inserted;
    updated += result.updated;
    failed += result.failed;
  }

  const result = {
    ok: true,
    inserted,
    updated,
    failed,
    feeds: feeds.length,
    time: new Date().toISOString()
  };

  console.log(
    'SYNC RESULT:',
    JSON.stringify(result)
  );

  return result;
}

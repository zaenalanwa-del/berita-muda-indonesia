import 'dotenv/config';
import Parser from 'rss-parser';
import { supabase } from './supabase.js';

const parser = new Parser({
  timeout: 8000,
  headers: {
    'User-Agent': 'Berita-Muda-Indonesia/1.0'
  }
});

// Sumber berita.
// Jika suatu feed mati/404, sistem otomatis melewatinya.
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
  'https://inet.detik.com/rss'
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
    text.includes('politik') ||
    text.includes('pemilu') ||
    text.includes('presiden')
  ) {
    return 'Politik';
  }

  if (
    text.includes('hukum') ||
    text.includes('polisi') ||
    text.includes('korupsi') ||
    text.includes('pengadilan')
  ) {
    return 'Hukum';
  }

  if (
    text.includes('ekonomi') ||
    text.includes('bisnis') ||
    text.includes('finance') ||
    text.includes('rupiah') ||
    text.includes('saham')
  ) {
    return 'Ekonomi';
  }

  if (
    text.includes('teknologi') ||
    text.includes('tekno') ||
    text.includes('tech') ||
    text.includes('gadget') ||
    text.includes('digital')
  ) {
    return 'Teknologi';
  }

  if (
    text.includes('internasional') ||
    text.includes('world') ||
    text.includes('amerika') ||
    text.includes('eropa') ||
    text.includes('china')
  ) {
    return 'Internasional';
  }

  return 'Nasional';
}

function getImage(item) {
  if (item.enclosure?.url) {
    return item.enclosure.url;
  }

  if (item['media:content']?.url) {
    return item['media:content'].url;
  }

  if (item['media:thumbnail']?.url) {
    return item['media:thumbnail'].url;
  }

  return null;
}

async function processFeed(url) {
  let inserted = 0;
  let updated = 0;
  let failed = 0;

  try {
    console.log(`Membaca feed: ${url}`);

    const feed = await parser.parseURL(url);

    const items = (feed.items || []).slice(0, 8);

    console.log(
      `Feed berhasil: ${url} | ${items.length} artikel`
    );

    for (const item of items) {
      try {
        const title = cleanText(item.title);

        if (!title) {
          continue;
        }

        const articleUrl = cleanText(
          item.link ||
          item.guid ||
          ''
        );

        if (!articleUrl) {
          continue;
        }

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

        const source =
          cleanText(feed.title) ||
          'Berita Muda Indonesia';

        const imageUrl = getImage(item);

        // Cek apakah berita sudah ada
        const { data: existing, error: findError } =
          await supabase
            .from('articles')
            .select('id')
            .eq('url', articleUrl)
            .maybeSingle();

        if (findError) {
          console.error(
            `Gagal mencari artikel: ${findError.message}`
          );

          failed++;
          continue;
        }

        const article = {
          title,
          url: articleUrl,
          description,
          category,
          published_at: publishedAt,
          source,
          image_url: imageUrl
        };

        // UPDATE berita lama
        if (existing?.id) {
          const { error } =
            await supabase
              .from('articles')
              .update(article)
              .eq('id', existing.id);

          if (error) {
            console.error(
              `Gagal update artikel: ${error.message}`
            );

            failed++;
          } else {
            updated++;
          }

          continue;
        }

        // INSERT berita baru
        const { error } =
          await supabase
            .from('articles')
            .insert(article);

        if (error) {
          console.error(
            `Gagal insert artikel: ${error.message}`
          );

          failed++;
        } else {
          inserted++;
        }

      } catch (error) {
        console.error(
          `Gagal memproses artikel: ${error.message}`
        );

        failed++;
      }
    }

  } catch (error) {

    // PENTING:
    // Feed 404 / timeout / error tidak menghentikan
    // sinkronisasi feed lainnya.

    console.warn(
      `Feed dilewati: ${url} | ${error.message}`
    );

    return {
      inserted: 0,
      updated: 0,
      failed: 0,
      skipped: 1
    };
  }

  return {
    inserted,
    updated,
    failed,
    skipped: 0
  };
}

export async function syncFeeds() {
  let inserted = 0;
  let updated = 0;
  let failed = 0;
  let skipped = 0;

  console.log(
    `Memulai sinkronisasi ${feeds.length} feed...`
  );

  /*
   * Jalankan feed secara bersamaan.
   * Ini jauh lebih cepat daripada menunggu
   * satu feed selesai baru membaca feed berikutnya.
   */

  const results = await Promise.all(
    feeds.map((url) => processFeed(url))
  );

  for (const result of results) {
    inserted += result.inserted || 0;
    updated += result.updated || 0;
    failed += result.failed || 0;
    skipped += result.skipped || 0;
  }

  const result = {
    ok: true,
    inserted,
    updated,
    failed,
    skipped,
    feeds: feeds.length,
    time: new Date().toISOString()
  };

  console.log(
    'SYNC RESULT:',
    JSON.stringify(result)
  );

  return result;
}

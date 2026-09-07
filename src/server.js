import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { syncFeeds } from './sync.js';
import { supabase } from './supabase.js';
import { createClient } from '@supabase/supabase-js';

/* =========================================================
   ENVIRONMENT
========================================================= */

const required = [
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY'
];

const missing = required.filter((key) => !process.env[key]);

if (missing.length) {
  throw new Error(
    `Missing required environment variables: ${missing.join(', ')}`
  );
}

/* =========================================================
   SUPABASE CLIENTS
========================================================= */

const authClient = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const adminClient = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      persistSession: false
    }
  }
);

/* =========================================================
   APP CONFIG
========================================================= */

const app = express();

const PORT = Number(process.env.PORT || 3000);

const origin = process.env.CORS_ORIGIN || '*';

const baseUrl = (
  process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`
).replace(/\/$/, '');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, '..', 'public');

/* =========================================================
   MIDDLEWARE
========================================================= */

app.use(
  helmet({
    contentSecurityPolicy: false
  })
);

app.set('trust proxy', 1);

app.use(
  cors({
    origin:
      origin === '*'
        ? true
        : origin.split(',').map((item) => item.trim()),
    credentials: false
  })
);

app.use(
  express.json({
    limit: '2mb'
  })
);

app.use(morgan('tiny'));

app.use(
  rateLimit({
    windowMs: 60_000,
    max: 180,
    standardHeaders: true,
    legacyHeaders: false
  })
);

/* =========================================================
   HELPERS
========================================================= */

const htmlEscape = (value = '') =>
  String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      })[char]
  );

const cleanLimit = (value, max, fallback) => {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return fallback;
  }

  return Math.min(Math.max(Math.floor(number), 1), max);
};

const cleanSearch = (value = '') =>
  String(value)
    .replace(/[%(),]/g, '')
    .trim()
    .slice(0, 100);

const trackEvent = async ({
  event_type,
  content_type = null,
  content_id = null,
  path = null,
  referrer = null,
  session_id = null
}) => {
  try {
    await adminClient
      .from('analytics_events')
      .insert({
        event_type,
        content_type,
        content_id,
        path,
        referrer,
        session_id
      });
  } catch (error) {
    console.warn(
      'ANALYTICS ERROR:',
      error?.message || 'Unknown analytics error'
    );
  }
};

const rebuildTrending = async () => {
  try {
    const { error } = await adminClient.rpc('rebuild_trending');

    if (error) {
      console.warn(
        'REBUILD TRENDING dilewati:',
        error.message
      );

      return false;
    }

    return true;
  } catch (error) {
    console.warn(
      'REBUILD TRENDING dilewati:',
      error?.message || 'Unknown error'
    );

    return false;
  }
};

/* =========================================================
   DETAIL PAGE SEO SHELL
========================================================= */

const detailShell = ({ kind, item }) => {
  const title = htmlEscape(
    item.title || 'Berita Muda Indonesia'
  );

  const desc = htmlEscape(
    String(
      item.summary ||
      item.description ||
      'Berita terkini Berita Muda Indonesia'
    ).slice(0, 200)
  );

  const image = htmlEscape(
    item.image_url ||
      item.thumbnail_url ||
      `${baseUrl}/assets/brand-reference.png`
  );

  const pathName =
    kind === 'article'
      ? `/berita/${item.id}`
      : `/video/${item.id}`;

  const url = `${baseUrl}${pathName}`;

  const type =
    kind === 'article'
      ? 'article'
      : 'video.other';

  const query =
    kind === 'article'
      ? `article=${encodeURIComponent(item.id)}`
      : `video=${encodeURIComponent(item.id)}`;

  return `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">

<title>${title} | Berita Muda Indonesia</title>

<meta name="description" content="${desc}">

<link rel="canonical" href="${htmlEscape(url)}">

<meta property="og:type" content="${type}">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${desc}">
<meta property="og:image" content="${image}">
<meta property="og:url" content="${htmlEscape(url)}">
<meta property="og:site_name" content="Berita Muda Indonesia">

<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${title}">
<meta name="twitter:description" content="${desc}">
<meta name="twitter:image" content="${image}">

<link rel="stylesheet" href="/styles.css">
</head>

<body>

<header>
  <div class="top">
    BERITA MUDA INDONESIA
    <span>Informasi Cepat, Akurat</span>
  </div>
</header>

<main style="max-width:1100px;margin:40px auto;padding:20px">

  <div class="badge">
    ${kind === 'article' ? 'BERITA' : 'VIDEO'}
  </div>

  <h1>${title}</h1>

  <p>${desc}</p>

  <p>
    <a href="/">← Kembali ke Beranda</a>
  </p>

</main>

<script>
  location.replace('/?${query}');
</script>

</body>
</html>`;
};

/* =========================================================
   STATIC FILES
========================================================= */

app.use(
  express.static(publicDir, {
    extensions: ['html']
  })
);

app.get('/', (req, res) => {
  res.sendFile(
    path.join(publicDir, 'index.html')
  );
});

/* =========================================================
   STATIC INFORMATION PAGES
========================================================= */

app.get('/tentang-kami', (req, res) => {
  res.sendFile('about.html', {
    root: publicDir
  });
});

app.get('/kontak', (req, res) => {
  res.sendFile('contact.html', {
    root: publicDir
  });
});

app.get('/kebijakan-privasi', (req, res) => {
  res.sendFile('privacy.html', {
    root: publicDir
  });
});

app.get('/syarat-ketentuan', (req, res) => {
  res.sendFile('terms.html', {
    root: publicDir
  });
});

app.get('/pedoman-redaksi', (req, res) => {
  res.sendFile('editorial.html', {
    root: publicDir
  });
});

app.get('/disclaimer', (req, res) => {
  res.sendFile('disclaimer.html', {
    root: publicDir
  });
});

/* =========================================================
   DETAIL ROUTES
========================================================= */

app.get('/berita/:id', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('articles')
      .select('*')
      .eq('id', req.params.id)
      .eq('status', 'published')
      .single();

    if (error || !data) {
      return res
        .status(404)
        .send('Berita tidak ditemukan');
    }

    res.send(
      detailShell({
        kind: 'article',
        item: data
      })
    );
  } catch (error) {
    console.error(
      'ARTICLE DETAIL ERROR:',
      error?.message
    );

    res
      .status(500)
      .send('Terjadi kesalahan server');
  }
});

app.get('/video/:id', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('videos')
      .select(
        'id,title,description,thumbnail_url,category,created_at,status'
      )
      .eq('id', req.params.id)
      .eq('status', 'published')
      .single();

    if (error || !data) {
      return res
        .status(404)
        .send('Video tidak ditemukan');
    }

    res.send(
      detailShell({
        kind: 'video',
        item: data
      })
    );
  } catch (error) {
    console.error(
      'VIDEO DETAIL ERROR:',
      error?.message
    );

    res
      .status(500)
      .send('Terjadi kesalahan server');
  }
});

/* =========================================================
   RATE LIMITERS
========================================================= */

const authLimiter = rateLimit({
  windowMs: 15 * 60_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: true
});

const interactionLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false
});

/* =========================================================
   ANALYTICS
========================================================= */

app.post('/api/analytics/event', async (req, res) => {
  try {
    const allowed = [
      'pageview',
      'view',
      'like',
      'share',
      'video_play',
      'ad_impression',
      'ad_click'
    ];

    const {
      event_type,
      content_type,
      content_id,
      path: eventPath,
      referrer,
      session_id
    } = req.body || {};

    if (!allowed.includes(event_type)) {
      return res.status(400).json({
        error: 'event_type tidak valid'
      });
    }

    await trackEvent({
      event_type,
      content_type,
      content_id,
      path: eventPath,
      referrer,
      session_id: String(
        session_id || ''
      ).slice(0, 80)
    });

    res.status(204).end();
  } catch (error) {
    console.error(
      'ANALYTICS EVENT ERROR:',
      error?.message
    );

    res.status(204).end();
  }
});

/* =========================================================
   ARTICLES
========================================================= */

app.get('/api/articles', async (req, res) => {
  try {
    const limit = cleanLimit(
      req.query.limit,
      100,
      20
    );

    let query = supabase
      .from('articles')
      .select('*')
      .eq('status', 'published')
      .order('published_at', {
        ascending: false
      })
      .limit(limit);

    if (req.query.category) {
      query = query.eq(
        'category',
        String(req.query.category).trim()
      );
    }

    if (req.query.q) {
      const search = cleanSearch(req.query.q);

      if (search) {
        query = query.or(
          `title.ilike.%${search}%,summary.ilike.%${search}%,description.ilike.%${search}%`
        );
      }
    }

    const { data, error } = await query;

    if (error) {
      throw error;
    }

    res.json(data || []);
  } catch (error) {
    console.error(
      'ARTICLES ERROR:',
      error?.message
    );

    res.status(500).json({
      error: 'Gagal mengambil berita',
      detail: error?.message
    });
  }
});

app.get('/api/articles/:id', async (req, res) => {
  try {
    const {
      data,
      error
    } = await supabase
      .from('articles')
      .select('*')
      .eq('id', req.params.id)
      .eq('status', 'published')
      .single();

    if (error || !data) {
      return res.status(404).json({
        error: 'Artikel tidak ditemukan'
      });
    }

    res.json(data);
  } catch (error) {
    res.status(500).json({
      error: 'Gagal mengambil artikel'
    });
  }
});

app.post(
  '/api/articles/:id/view',
  interactionLimiter,
  async (req, res) => {
    const { error } = await supabase.rpc(
      'increment_article_views',
      {
        article_id: req.params.id
      }
    );

    await trackEvent({
      event_type: 'view',
      content_type: 'article',
      content_id: req.params.id,
      path: req.headers.referer || null
    });

    if (error) {
      console.error(
        'ARTICLE VIEW ERROR:',
        error.message
      );

      return res.status(500).json({
        error: 'Gagal mencatat view'
      });
    }

    res.status(204).end();
  }
);

app.post(
  '/api/articles/:id/like',
  interactionLimiter,
  async (req, res) => {
    const { error } = await supabase.rpc(
      'increment_article_likes',
      {
        article_id: req.params.id
      }
    );

    await trackEvent({
      event_type: 'like',
      content_type: 'article',
      content_id: req.params.id
    });

    if (error) {
      console.error(
        'ARTICLE LIKE ERROR:',
        error.message
      );

      return res.status(500).json({
        error: 'Gagal mencatat like'
      });
    }

    res.status(204).end();
  }
);

app.post(
  '/api/articles/:id/share',
  interactionLimiter,
  async (req, res) => {
    const { error } = await supabase.rpc(
      'increment_article_shares',
      {
        article_id: req.params.id
      }
    );

    await trackEvent({
      event_type: 'share',
      content_type: 'article',
      content_id: req.params.id
    });

    if (error) {
      console.error(
        'ARTICLE SHARE ERROR:',
        error.message
      );

      return res.status(500).json({
        error: 'Gagal mencatat share'
      });
    }

    res.status(204).end();
  }
);

/* =========================================================
   VIDEOS
========================================================= */

app.get('/api/videos', async (req, res) => {
  try {
    const limit = cleanLimit(
      req.query.limit,
      50,
      20
    );

    let query = supabase
      .from('videos')
      .select(
        'id,title,description,thumbnail_url,source,category,views,likes,shares,status,created_at,updated_at'
      )
      .eq('status', 'published')
      .order('created_at', {
        ascending: false
      })
      .limit(limit);

    if (req.query.category) {
      query = query.eq(
        'category',
        String(req.query.category).trim()
      );
    }

    const { data, error } = await query;

    if (error) {
      throw error;
    }

    res.json(data || []);
  } catch (error) {
    console.error(
      'VIDEOS ERROR:',
      error?.message
    );

    res.status(500).json({
      error: 'Gagal mengambil video',
      detail: error?.message
    });
  }
});

/* =========================================================
   USER AUTH
========================================================= */

const requireUser = async (
  req,
  res,
  next
) => {
  try {
    const authorization =
      req.headers.authorization || '';

    if (!authorization.startsWith('Bearer ')) {
      return res.status(401).json({
        error: 'Login Google diperlukan'
      });
    }

    const token =
      authorization.slice(7);

    const {
      data: { user },
      error
    } = await adminClient.auth.getUser(token);

    if (error || !user) {
      return res.status(401).json({
        error: 'Sesi login tidak valid'
      });
    }

    req.user = user;

    next();
  } catch (error) {
    console.error(
      'USER AUTH ERROR:',
      error?.message
    );

    res.status(401).json({
      error: 'Sesi login tidak valid'
    });
  }
};

/* =========================================================
   VIDEO PLAY
========================================================= */

app.get(
  '/api/videos/:id/play',
  requireUser,
  async (req, res) => {
    try {
      const {
        data,
        error
      } = await adminClient
        .from('videos')
        .select(
          'id,video_url,thumbnail_url,status'
        )
        .eq('id', req.params.id)
        .eq('status', 'published')
        .single();

      if (error || !data) {
        return res.status(404).json({
          error: 'Video tidak ditemukan'
        });
      }

      let url = data.video_url;

      const storagePrefix =
        'supabase://videos/';

      if (
        typeof url === 'string' &&
        url.startsWith(storagePrefix)
      ) {
        const storagePath =
          url.slice(storagePrefix.length);

        const {
          data: signed,
          error: signError
        } = await adminClient.storage
          .from('videos')
          .createSignedUrl(
            storagePath,
            600
          );

        if (
          signError ||
          !signed?.signedUrl
        ) {
          return res.status(500).json({
            error:
              'Gagal membuat URL video aman'
          });
        }

        url = signed.signedUrl;
      }

      res.json({
        url,
        thumbnail_url:
          data.thumbnail_url || null,
        expiresIn: 600
      });
    } catch (error) {
      console.error(
        'VIDEO PLAY ERROR:',
        error?.message
      );

      res.status(500).json({
        error: 'Gagal membuka video'
      });
    }
  }
);

app.post(
  '/api/videos/:id/view',
  interactionLimiter,
  requireUser,
  async (req, res) => {
    const { error } =
      await supabase.rpc(
        'increment_video_views',
        {
          video_id: req.params.id
        }
      );

    await trackEvent({
      event_type: 'view',
      content_type: 'video',
      content_id: req.params.id
    });

    if (error) {
      return res.status(500).json({
        error: 'Gagal mencatat view video'
      });
    }

    res.status(204).end();
  }
);

app.post(
  '/api/videos/:id/like',
  interactionLimiter,
  requireUser,
  async (req, res) => {
    const { error } =
      await supabase.rpc(
        'increment_video_likes',
        {
          video_id: req.params.id
        }
      );

    await trackEvent({
      event_type: 'like',
      content_type: 'video',
      content_id: req.params.id
    });

    if (error) {
      return res.status(500).json({
        error: 'Gagal mencatat like video'
      });
    }

    res.status(204).end();
  }
);

app.post(
  '/api/videos/:id/share',
  interactionLimiter,
  async (req, res) => {
    const { error } =
      await supabase.rpc(
        'increment_video_shares',
        {
          video_id: req.params.id
        }
      );

    await trackEvent({
      event_type: 'share',
      content_type: 'video',
      content_id: req.params.id
    });

    if (error) {
      return res.status(500).json({
        error: 'Gagal mencatat share video'
      });
    }

    res.status(204).end();
  }
);

/* =========================================================
   TRENDING
========================================================= */

app.get('/api/trending', async (req, res) => {
  try {
    const limit = cleanLimit(
      req.query.limit,
      20,
      10
    );

    const [
      articlesResult,
      videosResult
    ] = await Promise.all([
      adminClient
        .from('articles')
        .select(
          'id,title,summary,image_url,category,views,likes,shares,published_at'
        )
        .eq('status', 'published')
        .order('views', {
          ascending: false
        })
        .limit(limit),

      adminClient
        .from('videos')
        .select(
          'id,title,description,thumbnail_url,category,views,likes,shares,created_at'
        )
        .eq('status', 'published')
        .order('views', {
          ascending: false
        })
        .limit(limit)
    ]);

    if (articlesResult.error) {
      throw articlesResult.error;
    }

    if (videosResult.error) {
      throw videosResult.error;
    }

    const calculateScore = (item) =>
      Number(item.views || 0) +
      Number(item.likes || 0) * 2 +
      Number(item.shares || 0) * 3;

    const articles =
      (articlesResult.data || []).map(
        (item) => ({
          ...item,
          content_type: 'article',
          trending_score:
            calculateScore(item)
        })
      );

    const videos =
      (videosResult.data || []).map(
        (item) => ({
          ...item,
          content_type: 'video',
          trending_score:
            calculateScore(item)
        })
      );

    const result = [
      ...articles,
      ...videos
    ]
      .sort(
        (a, b) =>
          b.trending_score -
          a.trending_score
      )
      .slice(0, limit)
      .map((item, index) => ({
        content_type:
          item.content_type,

        content_id: item.id,

        score:
          item.trending_score,

        rank: index + 1,

        item
      }));

    res.json(result);
  } catch (error) {
    console.error(
      'TRENDING ERROR:',
      error?.message
    );

    res.status(500).json({
      error: 'Gagal mengambil trending',
      detail: error?.message
    });
  }
});

/* =========================================================
   ADS
========================================================= */

app.get('/api/ads', async (req, res) => {
  try {
    const placement = String(
      req.query.placement || 'top'
    ).trim();

    const now =
      new Date().toISOString();

    const {
      data,
      error
    } = await supabase
      .from('ad_campaigns')
      .select(
        'id,advertiser_name,title,placement,image_url,target_url,alt_text'
      )
      .eq('placement', placement)
      .eq('active', true)
      .lte('starts_at', now)
      .or(
        `ends_at.is.null,ends_at.gte.${now}`
      )
      .order('created_at', {
        ascending: false
      })
      .limit(5);

    if (error) {
      console.warn(
        'ADS: tabel/iklan belum tersedia:',
        error.message
      );

      return res.json([]);
    }

    res.json(data || []);
  } catch (error) {
    console.warn(
      'ADS ERROR:',
      error?.message
    );

    res.json([]);
  }
});

app.post(
  '/api/ads/:id/impression',
  interactionLimiter,
  async (req, res) => {
    try {
      const { error } =
        await adminClient.rpc(
          'increment_ad_impressions',
          {
            campaign_id: req.params.id
          }
        );

      await trackEvent({
        event_type: 'ad_impression',
        content_type: 'ad',
        content_id: req.params.id
      });

      if (error) {
        return res.status(500).json({
          error:
            'Gagal mencatat impression iklan'
        });
      }

      res.status(204).end();
    } catch (error) {
      console.error(
        'AD IMPRESSION ERROR:',
        error?.message
      );

      res.status(500).json({
        error:
          'Gagal mencatat impression iklan'
      });
    }
  }
);

app.post(
  '/api/ads/:id/click',
  interactionLimiter,
  async (req, res) => {
    try {
      const { error } =
        await adminClient.rpc(
          'increment_ad_clicks',
          {
            campaign_id: req.params.id
          }
        );

      await trackEvent({
        event_type: 'ad_click',
        content_type: 'ad',
        content_id: req.params.id
      });

      if (error) {
        return res.status(500).json({
          error:
            'Gagal mencatat klik iklan'
        });
      }

      res.status(204).end();
    } catch (error) {
      console.error(
        'AD CLICK ERROR:',
        error?.message
      );

      res.status(500).json({
        error:
          'Gagal mencatat klik iklan'
      });
    }
  }
);

/* =========================================================
   CONFIG
========================================================= */

app.get('/api/config', (req, res) => {
  res.json({
    supabaseUrl:
      process.env.SUPABASE_URL || '',

    supabaseAnonKey:
      process.env.SUPABASE_ANON_KEY || '',

    publicBaseUrl:
      baseUrl,

    gaMeasurementId:
      process.env.GA_MEASUREMENT_ID || ''
  });
});

/* =========================================================
   CRON SYNC
========================================================= */

app.get(
  '/api/cron/sync',
  async (req, res) => {
    const expected =
      process.env.CRON_SECRET;

    if (!expected) {
      return res.status(503).json({
        error:
          'CRON_SECRET belum dikonfigurasi'
      });
    }

    const authorization =
      req.headers.authorization || '';

    if (
      authorization !==
      `Bearer ${expected}`
    ) {
      return res.status(401).json({
        error: 'Unauthorized'
      });
    }

    try {
      const result =
        await syncFeeds();

      /*
       * Setelah feed selesai,
       * bangun ulang data trending.
       */
      await rebuildTrending();

      /*
       * HANYA SATU res.json().
       * Duplicate response sudah dihapus.
       */
      return res.json({
        ok: true,
        ...result
      });
    } catch (error) {
      console.error(
        'CRON SYNC ERROR:',
        error
      );

      return res.status(500).json({
        ok: false,
        error:
          error?.message ||
          'Sinkronisasi gagal'
      });
    }
  }
);

/* =========================================================
   ADMIN LOGIN
========================================================= */

app.post(
  '/api/admin/login',
  authLimiter,
  async (req, res) => {
    try {
      const {
        email,
        password
      } = req.body || {};

      if (!email || !password) {
        return res.status(400).json({
          error:
            'Email dan password wajib diisi'
        });
      }

      const {
        data,
        error
      } =
        await authClient.auth.signInWithPassword({
          email,
          password
        });

      if (
        error ||
        !data?.session
      ) {
        return res.status(401).json({
          error: 'Login gagal'
        });
      }

      const {
        data: profile
      } =
        await adminClient
          .from('profiles')
          .select('role')
          .eq('id', data.user.id)
          .maybeSingle();

      if (
        !profile ||
        !['admin', 'editor'].includes(
          profile.role
        )
      ) {
        return res.status(403).json({
          error:
            'Akun bukan admin/editor'
        });
      }

      res.json({
        ok: true,
        token:
          data.session.access_token,
        user: data.user,
        role: profile.role
      });
    } catch (error) {
      console.error(
        'ADMIN LOGIN ERROR:',
        error?.message
      );

      res.status(500).json({
        error: 'Login gagal'
      });
    }
  }
);

/* =========================================================
   ADMIN AUTH MIDDLEWARE
========================================================= */

const admin = async (
  req,
  res,
  next
) => {
  try {
    const authorization =
      req.headers.authorization || '';

    if (
      !authorization.startsWith(
        'Bearer '
      )
    ) {
      return res.status(401).json({
        error: 'Unauthorized'
      });
    }

    const token =
      authorization.slice(7);

    const {
      data: { user },
      error
    } =
      await adminClient.auth.getUser(
        token
      );

    if (error || !user) {
      return res.status(401).json({
        error:
          'Session tidak valid'
      });
    }

    const {
      data: profile
    } =
      await adminClient
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .maybeSingle();

    if (
      !profile ||
      !['admin', 'editor'].includes(
        profile.role
      )
    ) {
      return res.status(403).json({
        error: 'Forbidden'
      });
    }

    req.user = user;
    req.role = profile.role;

    next();
  } catch (error) {
    console.error(
      'ADMIN AUTH ERROR:',
      error?.message
    );

    res.status(401).json({
      error: 'Session tidak valid'
    });
  }
};

/* =========================================================
   ADMIN STATS
========================================================= */

app.get(
  '/api/admin/stats',
  admin,
  async (req, res) => {
    try {
      const [
        articlesResult,
        draftsResult,
        videosResult
      ] = await Promise.all([
        adminClient
          .from('articles')
          .select(
            'id,title,category,views,likes,shares,published_at,status'
          )
          .eq('status', 'published')
          .order('views', {
            ascending: false
          })
          .limit(1000),

        adminClient
          .from('articles')
          .select('id', {
            count: 'exact',
            head: true
          })
          .eq('status', 'draft'),

        adminClient
          .from('videos')
          .select(
            'id,title,category,views,likes,shares,created_at,status'
          )
          .eq('status', 'published')
          .order('views', {
            ascending: false
          })
          .limit(1000)
      ]);

      if (
        articlesResult.error ||
        draftsResult.error ||
        videosResult.error
      ) {
        throw (
          articlesResult.error ||
          draftsResult.error ||
          videosResult.error
        );
      }

      const articles =
        articlesResult.data || [];

      const videos =
        videosResult.data || [];

      const all = [
        ...articles,
        ...videos
      ];

      const top = [...all]
        .sort(
          (a, b) =>
            (
              Number(b.views || 0) +
              Number(b.shares || 0) * 3
            ) -
            (
              Number(a.views || 0) +
              Number(a.shares || 0) * 3
            )
        )
        .slice(0, 10);

      res.json({
        publishedArticles:
          articles.length,

        draftArticles:
          draftsResult.count || 0,

        videos:
          videos.length,

        views:
          all.reduce(
            (sum, item) =>
              sum +
              Number(item.views || 0),
            0
          ),

        likes:
          all.reduce(
            (sum, item) =>
              sum +
              Number(item.likes || 0),
            0
          ),

        shares:
          all.reduce(
            (sum, item) =>
              sum +
              Number(item.shares || 0),
            0
          ),

        topContent: top
      });
    } catch (error) {
      console.error(
        'ADMIN STATS ERROR:',
        error?.message
      );

      res.status(500).json({
        error: error?.message
      });
    }
  }
);

/* =========================================================
   ADMIN ARTICLES
========================================================= */

app.get(
  '/api/admin/articles',
  admin,
  async (req, res) => {
    try {
      const {
        data,
        error
      } =
        await adminClient
          .from('articles')
          .select('*')
          .order('created_at', {
            ascending: false
          })
          .limit(200);

      if (error) {
        throw error;
      }

      res.json(data || []);
    } catch (error) {
      res.status(500).json({
        error: error?.message
      });
    }
  }
);

app.post(
  '/api/admin/articles',
  admin,
  async (req, res) => {
    try {
      const {
        data,
        error
      } =
        await adminClient
          .from('articles')
          .insert(req.body)
          .select()
          .single();

      if (error) {
        return res.status(400).json({
          error: error.message
        });
      }

      res.status(201).json(data);
    } catch (error) {
      res.status(500).json({
        error: error?.message
      });
    }
  }
);

app.patch(
  '/api/admin/articles/:id',
  admin,
  async (req, res) => {
    try {
      const {
        data,
        error
      } =
        await adminClient
          .from('articles')
          .update({
            ...req.body,
            updated_at:
              new Date().toISOString()
          })
          .eq('id', req.params.id)
          .select()
          .single();

      if (error) {
        return res.status(400).json({
          error: error.message
        });
      }

      res.json(data);
    } catch (error) {
      res.status(500).json({
        error: error?.message
      });
    }
  }
);

app.delete(
  '/api/admin/articles/:id',
  admin,
  async (req, res) => {
    try {
      const { error } =
        await adminClient
          .from('articles')
          .delete()
          .eq('id', req.params.id);

      if (error) {
        return res.status(400).json({
          error: error.message
        });
      }

      res.status(204).end();
    } catch (error) {
      res.status(500).json({
        error: error?.message
      });
    }
  }
);

/* =========================================================
   ADMIN VIDEOS
========================================================= */

app.get(
  '/api/admin/videos',
  admin,
  async (req, res) => {
    try {
      const {
        data,
        error
      } =
        await adminClient
          .from('videos')
          .select('*')
          .order('created_at', {
            ascending: false
          })
          .limit(200);

      if (error) {
        throw error;
      }

      res.json(data || []);
    } catch (error) {
      res.status(500).json({
        error: error?.message
      });
    }
  }
);

app.post(
  '/api/admin/videos',
  admin,
  async (req, res) => {
    try {
      const {
        data,
        error
      } =
        await adminClient
          .from('videos')
          .insert(req.body)
          .select()
          .single();

      if (error) {
        return res.status(400).json({
          error: error.message
        });
      }

      res.status(201).json(data);
    } catch (error) {
      res.status(500).json({
        error: error?.message
      });
    }
  }
);

app.patch(
  '/api/admin/videos/:id',
  admin,
  async (req, res) => {
    try {
      const {
        data,
        error
      } =
        await adminClient
          .from('videos')
          .update({
            ...req.body,
            updated_at:
              new Date().toISOString()
          })
          .eq('id', req.params.id)
          .select()
          .single();

      if (error) {
        return res.status(400).json({
          error: error.message
        });
      }

      res.json(data);
    } catch (error) {
      res.status(500).json({
        error: error?.message
      });
    }
  }
);

app.delete(
  '/api/admin/videos/:id',
  admin,
  async (req, res) => {
    try {
      const { error } =
        await adminClient
          .from('videos')
          .delete()
          .eq('id', req.params.id);

      if (error) {
        return res.status(400).json({
          error: error.message
        });
      }

      res.status(204).end();
    } catch (error) {
      res.status(500).json({
        error: error?.message
      });
    }
  }
);

/* =========================================================
   ADMIN ADS
========================================================= */

app.get(
  '/api/admin/ads',
  admin,
  async (req, res) => {
    try {
      const {
        data,
        error
      } =
        await adminClient
          .from('ad_campaigns')
          .select('*')
          .order('created_at', {
            ascending: false
          })
          .limit(200);

      if (error) {
        throw error;
      }

      res.json(data || []);
    } catch (error) {
      res.status(500).json({
        error: error?.message
      });
    }
  }
);

app.post(
  '/api/admin/ads',
  admin,
  async (req, res) => {
    try {
      const {
        data,
        error
      } =
        await adminClient
          .from('ad_campaigns')
          .insert(req.body)
          .select()
          .single();

      if (error) {
        return res.status(400).json({
          error: error.message
        });
      }

      res.status(201).json(data);
    } catch (error) {
      res.status(500).json({
        error: error?.message
      });
    }
  }
);

app.patch(
  '/api/admin/ads/:id',
  admin,
  async (req, res) => {
    try {
      const {
        data,
        error
      } =
        await adminClient
          .from('ad_campaigns')
          .update({
            ...req.body,
            updated_at:
              new Date().toISOString()
          })
          .eq('id', req.params.id)
          .select()
          .single();

      if (error) {
        return res.status(400).json({
          error: error.message
        });
      }

      res.json(data);
    } catch (error) {
      res.status(500).json({
        error: error?.message
      });
    }
  }
);

app.delete(
  '/api/admin/ads/:id',
  admin,
  async (req, res) => {
    try {
      const { error } =
        await adminClient
          .from('ad_campaigns')
          .delete()
          .eq('id', req.params.id);

      if (error) {
        return res.status(400).json({
          error: error.message
        });
      }

      res.status(204).end();
    } catch (error) {
      res.status(500).json({
        error: error?.message
      });
    }
  }
);

/* =========================================================
   SITEMAP
========================================================= */

app.get(
  '/sitemap.xml',
  async (req, res) => {
    try {
      const [
        articlesResult,
        videosResult
      ] = await Promise.all([
        supabase
          .from('articles')
          .select(
            'id,published_at'
          )
          .eq('status', 'published')
          .order('published_at', {
            ascending: false
          })
          .limit(5000),

        supabase
          .from('videos')
          .select(
            'id,created_at'
          )
          .eq('status', 'published')
          .order('created_at', {
            ascending: false
          })
          .limit(2000)
      ]);

      if (
        articlesResult.error ||
        videosResult.error
      ) {
        throw (
          articlesResult.error ||
          videosResult.error
        );
      }

      const urls = [
        `<url><loc>${htmlEscape(
          `${baseUrl}/`
        )}</loc></url>`
      ];

      for (
        const item of
        articlesResult.data || []
      ) {
        urls.push(
          `<url><loc>${htmlEscape(
            `${baseUrl}/berita/${item.id}`
          )}</loc>${
            item.published_at
              ? `<lastmod>${new Date(
                  item.published_at
                ).toISOString()}</lastmod>`
              : ''
          }</url>`
        );
      }

      for (
        const item of
        videosResult.data || []
      ) {
        urls.push(
          `<url><loc>${htmlEscape(
            `${baseUrl}/video/${item.id}`
          )}</loc>${
            item.created_at
              ? `<lastmod>${new Date(
                  item.created_at
                ).toISOString()}</lastmod>`
              : ''
          }</url>`
        );
      }

      res
        .type('application/xml')
        .send(
          `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('')}
</urlset>`
        );
    } catch (error) {
      console.error(
        'SITEMAP ERROR:',
        error?.message
      );

      res
        .status(500)
        .type('text/plain')
        .send(
          'Gagal membuat sitemap'
        );
    }
  }
);

/* =========================================================
   HEALTH CHECK
========================================================= */

const healthHandler =
  async (req, res) => {
    try {
      const {
        data,
        error
      } =
        await adminClient
          .from('articles')
          .select('id')
          .limit(1);

      if (error) {
        return res.status(503).json({
          ok: false,
          version:
            '4.4.0-growth-engine',
          database: false,
          error: error.message,
          code:
            error.code || null,
          hint:
            error.hint || null,
          time:
            new Date().toISOString()
        });
      }

      res.json({
        ok: true,
        version:
          '4.4.0-growth-engine',
        database: true,
        articlesQuery: true,
        time:
          new Date().toISOString()
      });
    } catch (error) {
      res.status(503).json({
        ok: false,
        version:
          '4.4.0-growth-engine',
        database: false,
        error:
          error?.message ||
          'Database connection failed',
        time:
          new Date().toISOString()
      });
    }
  };

app.get(
  '/health',
  healthHandler
);

app.get(
  '/api/health',
  healthHandler
);

/* =========================================================
   404 HANDLER
========================================================= */

app.use(
  (req, res) => {
    if (
      req.path.startsWith('/api/')
    ) {
      return res.status(404).json({
        error:
          'Endpoint tidak ditemukan'
      });
    }

    res.status(404).send(
      'Halaman tidak ditemukan'
    );
  }
);

/* =========================================================
   GLOBAL ERROR HANDLER
========================================================= */

app.use(
  (error, req, res, next) => {
    console.error(
      'GLOBAL ERROR:',
      error
    );

    if (res.headersSent) {
      return next(error);
    }

    res.status(500).json({
      error:
        'Internal server error'
    });
  }
);

/* =========================================================
   EXPORT
========================================================= */

export default app;

/* =========================================================
   LOCAL DEVELOPMENT
========================================================= */

if (
  process.env.VERCEL !== '1'
) {
  app.listen(
    PORT,
    () => {
      console.log(
        `BERITA MUDA V4.4 running on :${PORT}`
      );
    }
  );

  const runLocalSync =
    async () => {
      try {
        console.log(
          'LOCAL SYNC: memulai sinkronisasi...'
        );

        const result =
          await syncFeeds();

        console.log(
          'LOCAL SYNC RESULT:',
          JSON.stringify(result)
        );

        await rebuildTrending();
      } catch (error) {
        console.error(
          'LOCAL SYNC ERROR:',
          error?.message ||
            error
        );
      }
    };

  setTimeout(
    runLocalSync,
    3000
  );

  setInterval(
    runLocalSync,
    Math.max(
      1,
      Number(
        process.env
          .SYNC_INTERVAL_MINUTES
      ) || 5
    ) * 60_000
  );
}

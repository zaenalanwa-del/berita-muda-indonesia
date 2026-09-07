import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import { syncFeeds } from './sync.js';
import { supabase } from './supabase.js';
import { createClient } from '@supabase/supabase-js';

const required = ['SUPABASE_URL','SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY'];
const missing = required.filter(k => !process.env[k]);
if (missing.length) throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
const authClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const adminClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {auth:{persistSession:false}});
const app = express();
const PORT = Number(process.env.PORT || 3000);
const origin = process.env.CORS_ORIGIN || '*';
const baseUrl = (process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');

app.use(helmet({ contentSecurityPolicy: false }));
app.set('trust proxy', 1);
app.use(cors({ origin: origin === '*' ? true : origin.split(',').map(s => s.trim()), credentials: false }));
app.use(express.json({ limit: '2mb' }));
app.use(morgan('tiny'));
app.use(rateLimit({ windowMs: 60_000, max: 180, standardHeaders: true, legacyHeaders: false }));

const htmlEscape = (v='') => String(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const detailShell = ({kind, item}) => {
  const title = htmlEscape(item.title || 'Berita Muda Indonesia');
  const desc = htmlEscape((item.summary || item.description || 'Berita terkini Berita Muda Indonesia').slice(0, 200));
  const image = htmlEscape(item.image_url || item.thumbnail_url || `${baseUrl}/assets/brand-reference.png`);
  const path = kind === 'article' ? `/berita/${item.id}` : `/video/${item.id}`;
  const url = `${baseUrl}${path}`;
  const type = kind === 'article' ? 'article' : 'video.other';
  return `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} | Berita Muda Indonesia</title><meta name="description" content="${desc}"><link rel="canonical" href="${htmlEscape(url)}"><meta property="og:type" content="${type}"><meta property="og:title" content="${title}"><meta property="og:description" content="${desc}"><meta property="og:image" content="${image}"><meta property="og:url" content="${htmlEscape(url)}"><meta property="og:site_name" content="Berita Muda Indonesia"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${title}"><meta name="twitter:description" content="${desc}"><meta name="twitter:image" content="${image}"><link rel="stylesheet" href="/styles.css"></head><body><header><div class="top">BERITA MUDA INDONESIA <span>Informasi Cepat, Akurat</span></div></header><main style="max-width:1100px;margin:40px auto;padding:20px"><div class="badge">${kind === 'article' ? 'BERITA' : 'VIDEO'}</div><h1>${title}</h1><p>${desc}</p><p><a href="/">← Kembali ke Beranda</a></p></main><script>location.replace('/?${kind === 'article' ? 'article' : 'video'}=${encodeURIComponent('${item.id}')}');</script></body></html>`;
};

app.get('/berita/:id', async (req,res) => {
  const {data,error}=await supabase.from('articles').select('*').eq('id',req.params.id).eq('status','published').single();
  if(error||!data) return res.status(404).send('Berita tidak ditemukan');
  res.send(detailShell({kind:'article',item:data}));
});
app.get('/video/:id', async (req,res) => {
  const {data,error}=await supabase.from('videos').select('id,title,description,thumbnail_url,category,created_at,status').eq('id',req.params.id).eq('status','published').single();
  if(error||!data) return res.status(404).send('Video tidak ditemukan');
  res.send(detailShell({kind:'video',item:data}));
});

app.get('/tentang-kami', (req,res)=>res.sendFile('about.html',{root:'public'}));
app.get('/kontak', (req,res)=>res.sendFile('contact.html',{root:'public'}));
app.get('/kebijakan-privasi', (req,res)=>res.sendFile('privacy.html',{root:'public'}));
app.get('/syarat-ketentuan', (req,res)=>res.sendFile('terms.html',{root:'public'}));
app.get('/pedoman-redaksi', (req,res)=>res.sendFile('editorial.html',{root:'public'}));
app.get('/disclaimer', (req,res)=>res.sendFile('disclaimer.html',{root:'public'}));

app.use(express.static('public', { extensions: ['html'] }));

app.get('/', (req, res) => {
  res.sendFile('index.html', { root: 'public' });
});

const authLimiter = rateLimit({ windowMs: 15 * 60_000, max: 10, standardHeaders: true, legacyHeaders: false });
const interactionLimiter = rateLimit({ windowMs: 60_000, max: 30, standardHeaders: true, legacyHeaders: false });
const cleanLimit = (v, max, fallback) => Math.min(Math.max(Number(v) || fallback, 1), max);

const trackEvent = async ({event_type, content_type=null, content_id=null, path=null, referrer=null, session_id=null}) => {
  try { await adminClient.from('analytics_events').insert({event_type,content_type,content_id,path,referrer,session_id}); } catch (_) {}
};

app.post('/api/analytics/event', async (req,res) => {
  const allowed = ['pageview','view','like','share','video_play','ad_impression','ad_click'];
  const {event_type,content_type,content_id,path,referrer,session_id}=req.body||{};
  if(!allowed.includes(event_type)) return res.status(400).json({error:'event_type tidak valid'});
  await trackEvent({event_type,content_type,content_id,path,referrer,session_id:String(session_id||'').slice(0,80)});
  res.status(204).end();
});

app.get('/api/trending', async (req,res)=>{
  try {
    const limit=cleanLimit(req.query.limit,20,10);
    const {data,error}=await adminClient.from('trending_content').select('content_type,content_id,score,rank').order('rank',{ascending:true}).limit(limit);
    if(error) throw error;
    const idsA=(data||[]).filter(x=>x.content_type==='article').map(x=>x.content_id);
    const idsV=(data||[]).filter(x=>x.content_type==='video').map(x=>x.content_id);
    const [a,v]=await Promise.all([adminClient.from('articles').select('id,title,summary,image_url,category,views,likes,shares,published_at').in('id',idsA).eq('status','published'),adminClient.from('videos').select('id,title,description,thumbnail_url,category,views,likes,shares,created_at').in('id',idsV).eq('status','published')]);
    const map=new Map([...(a.data||[]).map(x=>['article:'+x.id,{...x,content_type:'article'}]),...(v.data||[]).map(x=>['video:'+x.id,{...x,content_type:'video'}])]);
    res.json((data||[]).map(t=>({...t,item:map.get(t.content_type+':'+t.content_id)})).filter(x=>x.item));
  } catch(e){res.status(500).json({error:e.message});}
});

app.get('/api/ads', async (req,res)=>{
  try { const placement=String(req.query.placement||'top'); const {data,error}=await supabase.from('ad_campaigns').select('id,advertiser_name,title,placement,image_url,target_url,alt_text').eq('placement',placement).eq('active',true).lte('starts_at',new Date().toISOString()).or('ends_at.is.null,ends_at.gte.'+new Date().toISOString()).order('created_at',{ascending:false}).limit(5); if(error) throw error; res.json(data||[]); } catch(e){res.status(500).json({error:e.message});}
});
app.post('/api/ads/:id/impression', interactionLimiter, async (req,res)=>{ const {error}=await adminClient.rpc('increment_ad_impressions',{campaign_id:req.params.id}); await trackEvent({event_type:'ad_impression',content_type:'ad',content_id:req.params.id}); res.status(error?500:204).end(); });
app.post('/api/ads/:id/click', interactionLimiter, async (req,res)=>{ const {error}=await adminClient.rpc('increment_ad_clicks',{campaign_id:req.params.id}); await trackEvent({event_type:'ad_click',content_type:'ad',content_id:req.params.id}); res.status(error?500:204).end(); });

app.get('/api/articles', async (req, res) => {
  try {
    let q = supabase.from('articles').select('*').eq('status', 'published').order('published_at', { ascending: false }).limit(cleanLimit(req.query.limit, 100, 20));
    if (req.query.category) q = q.eq('category', String(req.query.category).toUpperCase());
    if (req.query.q) q = q.or(`title.ilike.%${String(req.query.q).replace(/[%(),]/g, '')}%,summary.ilike.%${String(req.query.q).replace(/[%(),]/g, '')}%`);
    const { data, error } = await q;
    if (error) throw error;
    res.json(data || []);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/articles/:id', async (req, res) => {
  const { data, error } = await supabase.from('articles').select('*').eq('id', req.params.id).eq('status', 'published').single();
  if (error) return res.status(404).json({ error: 'Artikel tidak ditemukan' });
  res.json(data);
});

app.post('/api/articles/:id/view', interactionLimiter, async (req, res) => {
  const { error } = await supabase.rpc('increment_article_views', { article_id: req.params.id });
  await trackEvent({event_type:'view',content_type:'article',content_id:req.params.id,path:req.headers.referer||null});
  res.status(error ? 500 : 204).end();
});
app.post('/api/articles/:id/like', interactionLimiter, async (req, res) => {
  const { error } = await supabase.rpc('increment_article_likes', { article_id: req.params.id });
  await trackEvent({event_type:'like',content_type:'article',content_id:req.params.id});
  res.status(error ? 500 : 204).end();
});
app.post('/api/articles/:id/share', interactionLimiter, async (req, res) => {
  const { error } = await supabase.rpc('increment_article_shares', { article_id: req.params.id });
  await trackEvent({event_type:'share',content_type:'article',content_id:req.params.id});
  res.status(error ? 500 : 204).end();
});

app.get('/api/config', (req,res)=>res.json({supabaseUrl:process.env.SUPABASE_URL||'',supabaseAnonKey:process.env.SUPABASE_ANON_KEY||'',publicBaseUrl:baseUrl,gaMeasurementId:process.env.GA_MEASUREMENT_ID||''}));

app.get('/api/cron/sync', async (req,res) => {
  const expected = process.env.CRON_SECRET;
  if (!expected) return res.status(503).json({error:'CRON_SECRET belum dikonfigurasi'});
  const auth = req.headers.authorization || '';
  if (auth !== `Bearer ${expected}`) return res.status(401).json({error:'Unauthorized'});
  try { const result = await syncFeeds();
    await adminClient.rpc('rebuild_trending').catch(()=>{});
    res.json({ok:true, ...result}); }
  catch (e) { res.status(500).json({ok:false,error:e.message}); }
});

const requireUser = async (req,res,next) => {
  const h=req.headers.authorization||'';
  if(!h.startsWith('Bearer ')) return res.status(401).json({error:'Login Google diperlukan'});
  const {data:{user},error}=await adminClient.auth.getUser(h.slice(7));
  if(error||!user) return res.status(401).json({error:'Sesi login tidak valid'});
  req.user=user; next();
};

app.get('/api/videos', async (req, res) => {
  try {
    let q = supabase.from('videos').select('id,title,description,thumbnail_url,source,category,views,likes,shares,status,created_at,updated_at').eq('status', 'published').order('created_at', { ascending: false }).limit(cleanLimit(req.query.limit, 50, 20));
    if (req.query.category) q = q.eq('category', String(req.query.category).toUpperCase());
    const { data, error } = await q;
    if (error) throw error;
    res.json(data || []);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/videos/:id/play', requireUser, async (req,res)=>{
  const {data,error}=await adminClient.from('videos').select('id,video_url,thumbnail_url,status').eq('id',req.params.id).eq('status','published').single();
  if(error||!data) return res.status(404).json({error:'Video tidak ditemukan'});
  let url = data.video_url;
  const storagePrefix = 'supabase://videos/';
  if (typeof url === 'string' && url.startsWith(storagePrefix)) {
    const path = url.slice(storagePrefix.length);
    const { data: signed, error: signError } = await adminClient.storage.from('videos').createSignedUrl(path, 600);
    if (signError || !signed?.signedUrl) return res.status(500).json({error:'Gagal membuat URL video aman'});
    url = signed.signedUrl;
  }
  res.json({url,thumbnail_url:data.thumbnail_url||null,expiresIn:600});
});

app.post('/api/videos/:id/view', interactionLimiter, requireUser, async (req, res) => {
  const { error } = await supabase.rpc('increment_video_views', { video_id: req.params.id });
  await trackEvent({event_type:'view',content_type:'video',content_id:req.params.id});
  res.status(error ? 500 : 204).end();
});
app.post('/api/videos/:id/like', interactionLimiter, requireUser, async (req, res) => {
  const { error } = await supabase.rpc('increment_video_likes', { video_id: req.params.id });
  await trackEvent({event_type:'like',content_type:'video',content_id:req.params.id});
  res.status(error ? 500 : 204).end();
});
app.post('/api/videos/:id/share', interactionLimiter, async (req, res) => {
  const { error } = await supabase.rpc('increment_video_shares', { video_id: req.params.id });
  await trackEvent({event_type:'share',content_type:'video',content_id:req.params.id});
  res.status(error ? 500 : 204).end();
});

app.post('/api/admin/login', authLimiter, async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email dan password wajib diisi' });
  const { data, error } = await authClient.auth.signInWithPassword({ email, password });
  if (error || !data.session) return res.status(401).json({ error: 'Login gagal' });
  const { data: profile } = await adminClient.from('profiles').select('role').eq('id', data.user.id).maybeSingle();
  if (!profile || !['admin', 'editor'].includes(profile.role)) return res.status(403).json({ error: 'Akun bukan admin/editor' });
  res.json({ ok: true, token: data.session.access_token, user: data.user, role: profile.role });
});

const admin = async (req, res, next) => {
  const h = req.headers.authorization || '';
  if (!h.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  const { data: { user }, error } = await adminClient.auth.getUser(h.slice(7));
  if (error || !user) return res.status(401).json({ error: 'Session tidak valid' });
  const { data: profile } = await adminClient.from('profiles').select('role').eq('id', user.id).maybeSingle();
  if (!profile || !['admin', 'editor'].includes(profile.role)) return res.status(403).json({ error: 'Forbidden' });
  req.user = user; req.role = profile.role; next();
};

app.get('/api/admin/stats', admin, async (req, res) => {
  try {
    const [a, d, v] = await Promise.all([
      adminClient.from('articles').select('id,title,category,views,likes,shares,published_at,status').eq('status', 'published').order('views', { ascending: false }).limit(1000),
      adminClient.from('articles').select('id', { count: 'exact', head: true }).eq('status', 'draft'),
      adminClient.from('videos').select('id,title,category,views,likes,shares,created_at,status').eq('status', 'published').order('views', { ascending: false }).limit(1000)
    ]);
    if (a.error || d.error || v.error) throw a.error || d.error || v.error;
    const articles = a.data || [], videos = v.data || [];
    const all = [...articles, ...videos];
    const top = all.sort((x,y)=>(Number(y.views||0)+Number(y.shares||0)*3)-(Number(x.views||0)+Number(x.shares||0)*3)).slice(0,10);
    res.json({
      publishedArticles: articles.length, draftArticles: d.count || 0, videos: v.data?.length || 0,
      views: all.reduce((s,x)=>s+Number(x.views||0),0), likes: all.reduce((s,x)=>s+Number(x.likes||0),0),
      shares: all.reduce((s,x)=>s+Number(x.shares||0),0),
      topContent: top
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/articles', admin, async (req,res)=>{ const {data,error}=await adminClient.from('articles').select('*').order('created_at',{ascending:false}).limit(200); res.status(error?500:200).json(error?{error:error.message}:data); });
app.post('/api/admin/articles', admin, async (req,res)=>{ const {data,error}=await adminClient.from('articles').insert(req.body).select().single(); res.status(error?400:201).json(error?{error:error.message}:data); });
app.patch('/api/admin/articles/:id', admin, async (req,res)=>{ const {data,error}=await adminClient.from('articles').update({...req.body,updated_at:new Date().toISOString()}).eq('id',req.params.id).select().single(); res.status(error?400:200).json(error?{error:error.message}:data); });
app.delete('/api/admin/articles/:id', admin, async (req,res)=>{ const {error}=await adminClient.from('articles').delete().eq('id',req.params.id); res.status(error?400:204).end(); });
app.get('/api/admin/videos', admin, async (req,res)=>{ const {data,error}=await adminClient.from('videos').select('*').order('created_at',{ascending:false}).limit(200); res.status(error?500:200).json(error?{error:error.message}:data); });
app.post('/api/admin/videos', admin, async (req,res)=>{ const {data,error}=await adminClient.from('videos').insert(req.body).select().single(); res.status(error?400:201).json(error?{error:error.message}:data); });
app.patch('/api/admin/videos/:id', admin, async (req,res)=>{ const {data,error}=await adminClient.from('videos').update({...req.body,updated_at:new Date().toISOString()}).eq('id',req.params.id).select().single(); res.status(error?400:200).json(error?{error:error.message}:data); });
app.delete('/api/admin/videos/:id', admin, async (req,res)=>{ const {error}=await adminClient.from('videos').delete().eq('id',req.params.id); res.status(error?400:204).end(); });

app.get('/api/admin/ads', admin, async (req,res)=>{ const {data,error}=await adminClient.from('ad_campaigns').select('*').order('created_at',{ascending:false}).limit(200); res.status(error?500:200).json(error?{error:error.message}:data); });
app.post('/api/admin/ads', admin, async (req,res)=>{ const {data,error}=await adminClient.from('ad_campaigns').insert(req.body).select().single(); res.status(error?400:201).json(error?{error:error.message}:data); });
app.patch('/api/admin/ads/:id', admin, async (req,res)=>{ const {data,error}=await adminClient.from('ad_campaigns').update({...req.body,updated_at:new Date().toISOString()}).eq('id',req.params.id).select().single(); res.status(error?400:200).json(error?{error:error.message}:data); });
app.delete('/api/admin/ads/:id', admin, async (req,res)=>{ const {error}=await adminClient.from('ad_campaigns').delete().eq('id',req.params.id); res.status(error?400:204).end(); });

app.get('/sitemap.xml', async (req,res) => {
  try {
    const [a,v] = await Promise.all([
      supabase.from('articles').select('id,published_at').eq('status','published').order('published_at',{ascending:false}).limit(5000),
      supabase.from('videos').select('id,created_at').eq('status','published').order('created_at',{ascending:false}).limit(2000)
    ]);
    if (a.error || v.error) throw a.error || v.error;
    const urls = [`<url><loc>${baseUrl}/</loc></url>`];
    for (const x of a.data||[]) urls.push(`<url><loc>${baseUrl}/berita/${x.id}</loc>${x.published_at?`<lastmod>${new Date(x.published_at).toISOString()}</lastmod>`:''}</url>`);
    for (const x of v.data||[]) urls.push(`<url><loc>${baseUrl}/video/${x.id}</loc>${x.created_at?`<lastmod>${new Date(x.created_at).toISOString()}</lastmod>`:''}</url>`);
    res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join('')}</urlset>`);
  } catch (e) { res.status(500).type('text/plain').send(e.message); }
});

const healthHandler = async (req,res) => {
  try {
    const { data, error } = await adminClient.from('articles').select('id').limit(1);
    if (error) {
      return res.status(503).json({
        ok: false,
        version: '4.4.0-growth-engine',
        database: false,
        error: error.message,
        code: error.code || null,
        hint: error.hint || null,
        time: new Date().toISOString()
      });
    }
    res.json({ ok: true, version: '4.4.0-growth-engine', database: true, articlesQuery: true, time: new Date().toISOString() });
  } catch (error) {
    res.status(503).json({
      ok: false,
      version: '4.4.0-growth-engine',
      database: false,
      error: error?.message || 'Database connection failed',
      time: new Date().toISOString()
    });
  }
};
app.get('/health', healthHandler);
app.get('/api/health', healthHandler);

app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(500).json({error:'Internal server error'});
});

export default app;

if (process.env.VERCEL !== '1') {
  app.listen(PORT, () => console.log(`BERITA MUDA V4.3 running on :${PORT}`));
  setTimeout(async () => { await syncFeeds().catch(console.error); await adminClient.rpc('rebuild_trending').catch(console.error); }, 3000);
  setInterval(async () => { await syncFeeds().catch(console.error); await adminClient.rpc('rebuild_trending').catch(console.error); }, Math.max(1, Number(process.env.SYNC_INTERVAL_MINUTES) || 5) * 60000);
}

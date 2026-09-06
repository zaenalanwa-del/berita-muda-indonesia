import 'dotenv/config';
import Parser from 'rss-parser';
import { supabase } from './supabase.js';
const parser = new Parser({timeout:15000});
const feeds=(process.env.RSS_FEEDS||'').split(',').map(x=>x.trim()).filter(Boolean);
const categoryFor=(url,title='')=>{const s=(url+' '+title).toLowerCase(); for(const [k,v] of Object.entries({politik:'POLITIK',hukum:'HUKUM',ekonomi:'EKONOMI',teknologi:'TEKNOLOGI',olahraga:'OLAHRAGA',internasional:'INTERNASIONAL',hiburan:'HIBURAN',lifestyle:'LIFESTYLE'})) if(s.includes(k)) return v; return 'NASIONAL'};
export async function syncFeeds(){let inserted=0, failed=0;  for(const url of feeds){try{const feed=await parser.parseURL(url); const rows=(feed.items||[]).slice(0,50).map(i=>({title:(i.title||'').trim(),summary:(i.contentSnippet||i.content||'').replace(/<[^>]*>/g,'').slice(0,500),url:i.link,source:(feed.title||'RSS').slice(0,120),category:categoryFor(url,i.title),image_url:i.enclosure?.url||i['media:content']?.url||null,published_at:i.isoDate||i.pubDate||new Date().toISOString(),status:'published'})).filter(x=>x.title&&x.url); if(rows.length){const {error}=await supabase.from('articles').upsert(rows,{onConflict:'url',ignoreDuplicates:true}); if(error) throw error; inserted+=rows.length;}}catch(e){failed++; console.error('RSS failed',url,e.message)}} console.log(`[SYNC] feeds=${feeds.length} rows_seen=${inserted} failed=${failed}`); return {feeds:feeds.length,rowsSeen:inserted,failed};}
if(import.meta.url===`file://${process.argv[1]}`){await syncFeeds();}

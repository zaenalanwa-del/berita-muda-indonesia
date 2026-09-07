const SUPABASE_CDN='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
let supa=null,currentSession=null,gaId='';
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const sessionId=()=>{let x=localStorage.getItem('bm_session');if(!x){x=crypto.randomUUID?crypto.randomUUID():String(Date.now())+Math.random();localStorage.setItem('bm_session',x)}return x};

async function setupAuth(){
  const r=await fetch('/api/config'); const cfg=await r.json();
  gaId=cfg.gaMeasurementId||'';
  if(gaId){
    const s=document.createElement('script'); s.async=true;
    s.src='https://www.googletagmanager.com/gtag/js?id='+encodeURIComponent(gaId);
    document.head.appendChild(s); window.dataLayer=window.dataLayer||[];
    window.gtag=function(){dataLayer.push(arguments)};
    gtag('js',new Date()); gtag('config',gaId,{send_page_view:false});
  }
  if(!cfg.supabaseUrl||!cfg.supabaseAnonKey)throw Error('Konfigurasi Supabase belum siap');
  await new Promise((resolve,reject)=>{
    const s=document.createElement('script'); s.src=SUPABASE_CDN;
    s.onload=resolve; s.onerror=reject; document.head.appendChild(s)
  });
  supa=window.supabase.createClient(cfg.supabaseUrl,cfg.supabaseAnonKey);
  const {data}=await supa.auth.getSession(); currentSession=data.session;
  supa.auth.onAuthStateChange((_e,session)=>{currentSession=session;updateAuthUI()});
  updateAuthUI(); trackEvent('pageview','site',null,location.pathname);
  if(gaId)gtag('event','page_view',{page_location:location.href});
}

function updateAuthUI(){
  let el=$('#account');
  if(!el){el=document.createElement('div');el.id='account';document.querySelector('header')?.appendChild(el)}
  el.innerHTML=currentSession?`<span>👤 ${esc(currentSession.user.email||'Google user')}</span><button id="logoutBtn">KELUAR</button>`:`<span class="muted">Video memerlukan Login Google</span>`;
  if($('#logoutBtn'))$('#logoutBtn').onclick=()=>supa.auth.signOut();
}

async function loginGoogle(){
  if(!supa)return alert('Login belum siap.');
  const {error}=await supa.auth.signInWithOAuth({provider:'google',options:{redirectTo:window.location.origin}});
  if(error)alert('Login Google gagal: '+error.message)
}

async function trackEvent(event_type,content_type=null,content_id=null,path=location.pathname){
  fetch('/api/analytics/event',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({event_type,content_type,content_id,path,referrer:document.referrer||null,session_id:sessionId()})
  }).catch(()=>{})
}

async function trackArticleView(id){
  try{
    const r=await fetch('/api/articles/'+encodeURIComponent(id)+'/view',{method:'POST'});
    if(!r.ok)console.warn('Gagal mencatat view artikel:',r.status);
  }catch(e){console.warn('Gagal mencatat view artikel:',e)}
  trackEvent('view','article',id);
  if(gaId)gtag('event','article_view',{content_id:id});
}

async function openDeepLink(){
  const path=location.pathname;
  const articleId=path.startsWith('/berita/')?decodeURIComponent(path.split('/').pop()):new URLSearchParams(location.search).get('article');
  const videoId=path.startsWith('/video/')?decodeURIComponent(path.split('/').pop()):new URLSearchParams(location.search).get('video');

  if(articleId){
    const x=await fetch('/api/articles/'+encodeURIComponent(articleId)).then(r=>r.json()).catch(()=>({}));
    if(!x.error){
      document.querySelector('main').innerHTML=`<section class="detail"><div class="badge">${esc(x.category||'BERITA')}</div><h1>${esc(x.title)}</h1><div class="meta">${esc(x.source||'Berita Muda Indonesia')} · ${new Date(x.published_at||x.created_at).toLocaleString('id-ID')}</div><img class="detail-image" src="${esc(x.image_url||'/assets/brand-reference.png')}" onerror="this.src='/assets/brand-reference.png'"><p class="detail-summary">${esc(x.summary||x.description||'')}</p>${shareButtons('article',x.id,x.title)}<p><a href="/">← Kembali ke Beranda</a></p></section>`;
      bindShares();
      await trackArticleView(x.id);
      document.title=x.title+' | Berita Muda Indonesia';
    }
    return true
  }

  if(videoId){
    const v=await fetch('/api/videos?limit=100').then(r=>r.json()).catch(()=>[]);
    const x=(v||[]).find(y=>String(y.id)===String(videoId));
    if(x){
      document.querySelector('main').innerHTML=`<section class="detail"><div class="badge">VIDEO ${esc(x.category||'')}</div><h1>${esc(x.title)}</h1><p>${esc(x.description||'')}</p><div id="deepVideo"></div>${shareButtons('video',x.id,x.title)}<p><a href="/">← Kembali ke Beranda</a></p></section>`;
      bindShares(); $('#deepVideo').innerHTML=videoCard(x);
      $('#deepVideo .video-watch').onclick=()=>watchVideo(x.id);
      document.title=x.title+' | Video Berita Muda Indonesia';
    }
    return true
  }
  return false
}

async function load(){
  try{
    const [a,v,t,ads]=await Promise.all([
      fetch('/api/articles?limit=30').then(r=>r.json()),
      fetch('/api/videos?limit=20').then(r=>r.json()),
      fetch('/api/trending?limit=9').then(r=>r.json()),
      fetch('/api/ads?placement=top').then(r=>r.json())
    ]);
    if($('#articles'))$('#articles').innerHTML=(a||[]).map(x=>`<article class="card"><img src="${esc(x.image_url||'/assets/brand-reference.png')}" onerror="this.src='/assets/brand-reference.png'"><div class="card-body"><div class="cat">${esc(x.category)}</div><h3><a href="/berita/${encodeURIComponent(x.id)}">${esc(x.title)}</a></h3><p>${esc(x.summary||x.description||'')}</p><div class="meta">${esc(x.source)} · ${new Date(x.published_at||x.created_at).toLocaleString('id-ID')} · ${x.views||0} views · ${x.likes||0} likes · ${x.shares||0} shares</div>${shareButtons('article',x.id,x.title)}</div></article>`).join('');
    if($('#ticker'))$('#ticker').textContent=(a||[]).slice(0,5).map(x=>x.title).join(' • ');
    if($('#lastsync'))$('#lastsync').textContent='Auto-sync aktif • '+new Date().toLocaleTimeString('id-ID');
    if($('#videos')){
      $('#videos').innerHTML=(v||[]).map(videoCard).join('');
      document.querySelectorAll('.video-watch').forEach(b=>b.onclick=()=>watchVideo(b.dataset.id));
      bindShares()
    }
    renderTrending(t||[]);
    renderAds(ads||[],'#topAd');
    const ads2=await fetch('/api/ads?placement=inline').then(r=>r.json()).catch(()=>[]);
    renderAds(ads2,'#ads')
  }catch(e){console.error(e)}
}

function renderTrending(items){
  const el=$('#trending');if(!el)return;
  el.innerHTML=items.length?items.map((t,i)=>{
    const x=t.item;const href=t.content_type==='article'?'/berita/'+encodeURIComponent(x.id):'/video/'+encodeURIComponent(x.id);
    return `<div class="trend-card"><div class="rank">#${i+1}</div><div class="cat">${esc(x.category||'VIDEO')}</div><h3><a href="${href}">${esc(x.title)}</a></h3><div class="muted">${x.views||0} views · ${x.likes||0} likes · ${x.shares||0} shares · skor ${Number(t.score).toFixed(1)}</div></div>`
  }).join(''):'Belum ada data trending. Jalankan cron setelah migrasi.'
}

function renderAds(items,target){
  const el=$(target);if(!el)return;
  if(!items.length){if(target==='#ads')el.innerHTML='<div class="ad-card"><b>Slot sponsor siap.</b><p class="muted">Tambahkan kampanye dari CMS Admin untuk mulai menjual ruang iklan langsung.</p></div>';return}
  el.innerHTML=items.map(x=>`<div class="ad-card"><small>SPONSOR · ${esc(x.advertiser_name)}</small>${x.image_url?`<img src="${esc(x.image_url)}" alt="${esc(x.alt_text||x.title)}">`:''}<h3>${esc(x.title)}</h3><a href="${esc(x.target_url)}" target="_blank" rel="sponsored noopener" onclick="trackAd('${esc(x.id)}','click')">LIHAT PENAWARAN</a></div>`).join('');
  items.forEach(x=>trackAd(x.id,'impression'))
}

function trackAd(id,type){fetch('/api/ads/'+encodeURIComponent(id)+'/'+type,{method:'POST'}).catch(()=>{})}

function shareButtons(type,id,title){
  const path=type==='article'?`/berita/${encodeURIComponent(id)}`:`/video/${encodeURIComponent(id)}`;
  const url=location.origin+path,text=`${title} — Berita Muda Indonesia`;
  return `<div class="share-row"><span>Bagikan:</span><a class="share-btn" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(text+' '+url)}" data-share-type="${type}" data-share-id="${esc(id)}">WhatsApp</a><a class="share-btn" target="_blank" rel="noopener" href="https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}" data-share-type="${type}" data-share-id="${esc(id)}">Facebook</a><a class="share-btn" target="_blank" rel="noopener" href="https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}" data-share-type="${type}" data-share-id="${esc(id)}">X</a><a class="share-btn" target="_blank" rel="noopener" href="https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}" data-share-type="${type}" data-share-id="${esc(id)}">Telegram</a><button class="share-btn copy" data-url="${esc(url)}" data-share-type="${type}" data-share-id="${esc(id)}">Salin Link</button></div>`
}

function bindShares(){
  document.querySelectorAll('.share-row a[data-share-id]').forEach(a=>a.onclick=()=>trackShare(a.dataset.shareType,a.dataset.shareId));
  document.querySelectorAll('.share-row .copy').forEach(b=>b.onclick=async()=>{
    try{await navigator.clipboard.writeText(b.dataset.url);b.textContent='Tersalin ✓';trackShare(b.dataset.shareType,b.dataset.shareId);setTimeout(()=>b.textContent='Salin Link',1400)}
    catch{prompt('Salin link ini:',b.dataset.url)}
  })
}

function trackShare(type,id){
  const ep=type==='article'?`/api/articles/${encodeURIComponent(id)}/share`:`/api/videos/${encodeURIComponent(id)}/share`;
  fetch(ep,{method:'POST'}).catch(()=>{});
  trackEvent('share',type,id);
  if(gaId)gtag('event','share',{content_type:type,content_id:id})
}

function trackArticleLike(id){
  fetch('/api/articles/'+encodeURIComponent(id)+'/like',{method:'POST'})
    .then(r=>{if(!r.ok)throw Error('Gagal mencatat like')})
    .then(()=>{trackEvent('like','article',id);load()})
    .catch(e=>console.warn(e))
}

function articleLikeButton(x){
  return `<button class="like" data-article-like="${esc(x.id)}">♥ ${x.likes||0}</button>`
}

function bindArticleLikes(){
  document.querySelectorAll('[data-article-like]').forEach(b=>{
    b.onclick=()=>trackArticleLike(b.dataset.articleLike)
  })
}

function videoCard(x){
  return `<div class="video-card" data-video-id="${esc(x.id)}"><div class="video-lock" style="background-image:url('${esc(x.thumbnail_url||'/assets/brand-reference.png')}')"><div class="video-overlay"><div class="play">▶</div><b>LOGIN GOOGLE UNTUK MENONTON</b><button class="video-watch" data-id="${esc(x.id)}">TONTON VIDEO</button></div></div><div class="video-info"><b><a href="/video/${encodeURIComponent(x.id)}">${esc(x.title)}</a></b><div>${x.views||0} views · ${x.shares||0} shares ${likeVideoButton(x)}</div>${shareButtons('video',x.id,x.title)}</div></div>`
}

function likeVideoButton(x){
  return `<button class="like" data-video-like="${esc(x.id)}">♥ ${x.likes||0}</button>`
}

function bindVideoLikes(){
  document.querySelectorAll('[data-video-like]').forEach(b=>b.onclick=()=>likeVideo(b.dataset.videoLike))
}

async function watchVideo(id){
  if(!currentSession){sessionStorage.setItem('pendingVideoId',id);return loginGoogle()}
  try{
    const r=await fetch('/api/videos/'+encodeURIComponent(id)+'/play',{headers:{Authorization:'Bearer '+currentSession.access_token}});
    const x=await r.json();
    if(!r.ok)throw Error(x.error||'Video tidak dapat diputar');
    const card=document.querySelector(`[data-video-id="${CSS.escape(id)}"]`),lock=card?.querySelector('.video-lock');
    if(lock){lock.style.backgroundImage='none';lock.innerHTML=`<video controls autoplay playsinline preload="metadata" src="${esc(x.url)}" poster="${esc(x.thumbnail_url||'')}"></video>`}
    await fetch('/api/videos/'+encodeURIComponent(id)+'/view',{method:'POST',headers:{Authorization:'Bearer '+currentSession.access_token}});
    trackEvent('video_play','video',id);
    if(gaId)gtag('event','video_play',{content_id:id});
    load()
  }catch(e){alert(e.message)}
}

async function likeVideo(id){
  if(!currentSession)return loginGoogle();
  const r=await fetch('/api/videos/'+encodeURIComponent(id)+'/like',{method:'POST',headers:{Authorization:'Bearer '+currentSession.access_token}});
  if(!r.ok)return alert('Like video gagal.');
  trackEvent('like','video',id);load()
}

function bindAllInteractions(){
  bindShares();
  bindArticleLikes();
  bindVideoLikes();
}

(async()=>{
  try{await setupAuth()}catch(e){console.warn(e)}
  const deep=await openDeepLink();
  if(!deep)await load();
  setInterval(load,300000);
  setTimeout(()=>{
    const pending=sessionStorage.getItem('pendingVideoId');
    if(pending&&currentSession){sessionStorage.removeItem('pendingVideoId');watchVideo(pending)}
  },1000)
})();

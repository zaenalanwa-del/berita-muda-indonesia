# BERITA MUDA INDONESIA V4.3 — READY DEPLOY

Production-oriented news + video portal starter.

## Fitur V4.3
- Auto-sync RSS setiap 5 menit + deduplikasi
- Supabase Postgres + Storage
- Supabase Auth session verification untuk endpoint admin
- Role profile: admin/editor + RLS database
- CMS berita/video draft-publish
- Vertical video feed autoplay/pause
- SEO starter: robots.txt + sitemap.xml
- Rate limiting, Helmet, Docker

## Setup
1. Buat project Supabase.
2. Jalankan `supabase/schema.sql` di SQL Editor.
3. Aktifkan Email auth di Supabase Authentication.
4. Buat user admin di Authentication lalu insert role `admin` ke `public.profiles`.
5. Salin `.env.example` menjadi `.env` dan isi kredensial.
6. `npm install && npm start` atau `docker compose up --build`.

## Production checklist
- Jangan pernah expose SERVICE_ROLE_KEY ke browser.
- Gunakan HTTPS dan reverse proxy/CDN.
- Batasi ukuran/tipe upload video di Storage dan aplikasi.
- Aktifkan backup database Supabase.
- Review copyright/licensing untuk setiap sumber video.


## V4.3 changes
- Fixed RLS to use the real `articles` table (not `news`).
- Public article detail now exposes published items only.
- Added admin dashboard statistics.
- Added search via `/api/articles?q=...`.
- Added dynamic `/sitemap.xml` and protected admin indexing.
- Added stricter login and interaction rate limits.
- Added configurable CORS and `PUBLIC_BASE_URL`.
- Admin CRUD uses the server-side service role only after Supabase Auth + role verification.

For large video uploads, use Supabase Storage (or an object/CDN provider) and save the resulting URL in `video_url`; avoid sending large video files through the Express JSON API.

## Google Login untuk Video
Video sekarang memiliki gerbang login Google. Artikel tetap publik. Saat pengguna menekan TONTON VIDEO, pengguna yang belum login diarahkan ke Google OAuth melalui Supabase Auth. Setelah login, endpoint `/api/videos/:id/play` memvalidasi session sebelum memberikan URL video.
Lihat `GOOGLE-LOGIN-SETUP.md` untuk konfigurasi Google Cloud, Supabase dan Vercel.


## Google Login untuk Video
- Artikel tetap publik tanpa login.
- Login Google hanya diminta ketika pengguna menekan TONTON VIDEO.
- Setelah OAuth selesai, video yang sebelumnya dipilih akan otomatis dibuka.
- Endpoint play/view/like video memerlukan sesi pengguna.
- Untuk keamanan maksimum, gunakan bucket video private + signed URL yang kedaluwarsa.

## Share & Social SEO
- Artikel memiliki URL permanen `/berita/:id` dan video `/video/:id`.
- Tombol share: WhatsApp, Facebook, X, Telegram, dan Salin Link.
- Metadata Open Graph/Twitter dibuat server-side agar link yang dibagikan lebih mudah menghasilkan preview.
- Share counter tersedia melalui kolom `shares` dan RPC pada migration `002_share_seo.sql`.
- Jalankan migration `supabase/schema.sql` lalu `migrations/002_share_seo.sql` di Supabase.
- Endpoint publik `/api/videos` tidak lagi mengirim `video_url`; URL playback hanya diminta melalui endpoint login.


## Dashboard Monetisasi
Admin sekarang menampilkan views, likes, shares, konten teratas, serta simulasi pendapatan berbasis RPM. Simulasi bukan angka pendapatan AdSense aktual. Struktur berikutnya siap dikembangkan menjadi slot iklan sponsor, AdSense, affiliate, dan laporan trafik.


## Status nyata / production
Paket ini adalah kode aplikasi yang dapat dijalankan dan dideploy. Namun, uang nyata tidak boleh disimulasikan: pendapatan AdSense baru ada setelah akun AdSense disetujui dan iklan benar-benar tayang; sponsor harus memiliki kontrak/pembayaran; affiliate membutuhkan program dan link yang aktif. Nilai RPM pada dashboard hanyalah kalkulator.

Sebelum go-live, wajib isi `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `PUBLIC_BASE_URL`, dan `CORS_ORIGIN`. Jalankan SQL schema/migration di Supabase. Ganti email kontak contoh di halaman Kontak.

### Pemeriksaan lokal
`npm install` lalu `npm start`. Endpoint `/health` harus mengembalikan `ok:true` setelah Supabase terhubung.


## Deployment nyata ke Vercel
Vercel saat ini dapat mendeteksi Express secara otomatis dan menjalankannya sebagai satu Vercel Function. Aplikasi ini mengekspor `app` dari `src/server.js`, sehingga tidak membutuhkan server `listen()` di Vercel. Sinkronisasi RSS produksi memakai Vercel Cron `/api/cron/sync` setiap 5 menit; isi `CRON_SECRET` di Environment Variables.

Environment Variables Production minimum:
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `PUBLIC_BASE_URL`
- `CORS_ORIGIN`
- `CRON_SECRET`
- `RSS_FEEDS`

Setelah Environment Variables disimpan, lakukan redeploy. Jangan commit `.env` atau secret.

## Video private yang benar-benar dilindungi
Untuk video yang disimpan di Supabase Storage private bucket `videos`, isi `video_url` dengan format `supabase://videos/NAMA-FILE.mp4`. Endpoint login akan membuat signed URL yang berlaku 10 menit. Video eksternal tetap didukung, tetapi URL eksternal tidak dapat dibuat private oleh Supabase.

## V4.4 Growth Engine (added)

This build adds five production-oriented growth layers:

1. **Viral Engine** — `trending_content` ranking using views, likes, shares and freshness; rebuilt by the sync cron.
2. **Analytics Engine** — first-party `analytics_events` plus optional Google Analytics 4 via `GA_MEASUREMENT_ID`.
3. **Sponsor/Ad Engine** — `ad_campaigns`, public placements (`top`, `inline`, `sidebar`, `video`) and impression/click tracking, managed from `/admin.html`.
4. **Social Distribution Layer** — stronger share tracking and ready-to-use WhatsApp/Facebook/X/Telegram share cards.
5. **SEO/Editorial Intelligence** — article `NewsArticle` and video `VideoObject` JSON-LD is emitted on deep-link pages, alongside canonical/Open Graph metadata.

Run `supabase/schema.sql` for a fresh database, or run migrations `001`, `002`, and `003` in order for an existing installation.

### Important production truth
- This package is **deployment-ready code**, not proof of a live deployment.
- Real AdSense revenue requires a separate approved Google AdSense account and policy-compliant original content; the admin RPM calculator is only a simulation.
- Automatic social posting to third-party platforms still requires each platform's own API credentials/permissions. The current build provides share/distribution flows and tracking, not unauthorized auto-posting.
- Sponsor campaigns are real CMS records and can be sold directly, but the advertiser, creative, target URL and dates must be supplied by the operator.
- Replace the placeholder contact email in `public/contact.html` before launch.

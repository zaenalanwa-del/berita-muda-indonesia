create extension if not exists pgcrypto;
create table if not exists public.articles (
 id uuid primary key default gen_random_uuid(), title text not null, summary text, url text unique not null,
 image_url text, source text not null default 'ANTARA', category text not null default 'NASIONAL',
 published_at timestamptz, views bigint not null default 0, likes bigint not null default 0, shares bigint not null default 0,
 status text not null default 'published' check(status in ('draft','published','archived')),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists articles_category_idx on public.articles(category);
create index if not exists articles_published_idx on public.articles(published_at desc);
create table if not exists public.videos (
 id uuid primary key default gen_random_uuid(), title text not null, description text, video_url text not null,
 thumbnail_url text, source text not null default 'ADMIN', category text not null default 'VIDEO',
 views bigint not null default 0, likes bigint not null default 0, shares bigint not null default 0, status text not null default 'draft' check(status in ('draft','published','archived')),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.admins (id uuid primary key default gen_random_uuid(), email text unique not null, password_hash text not null, created_at timestamptz default now());
create or replace function increment_article_views(article_id uuid) returns void language sql security definer as $$ update public.articles set views=views+1 where id=article_id; $$;
create or replace function increment_article_likes(article_id uuid) returns void language sql security definer as $$ update public.articles set likes=likes+1 where id=article_id; $$;
create or replace function increment_video_views(video_id uuid) returns void language sql security definer as $$ update public.videos set views=views+1 where id=video_id; $$;
create or replace function increment_video_likes(video_id uuid) returns void language sql security definer as $$ update public.videos set likes=likes+1 where id=video_id; $$;
create or replace function public.increment_article_shares(article_id uuid) returns void language sql security definer set search_path=public as $$ update public.articles set shares=shares+1, updated_at=now() where id=article_id and status='published'; $$;
create or replace function public.increment_video_shares(video_id uuid) returns void language sql security definer set search_path=public as $$ update public.videos set shares=shares+1, updated_at=now() where id=video_id and status='published'; $$;
-- Storage bucket: create manually in Supabase dashboard as `videos` (public) and `thumbnails` (public), or use the Storage API.


-- V4.3 security / RLS (safe for the existing articles + videos schema)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'editor' check (role in ('admin','editor')),
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
drop policy if exists "users read own profile" on public.profiles;
create policy "users read own profile" on public.profiles for select using (auth.uid() = id);

alter table public.articles enable row level security;
alter table public.videos enable row level security;
drop policy if exists "public read published articles" on public.articles;
drop policy if exists "editor manage articles" on public.articles;
drop policy if exists "public read published videos" on public.videos;
drop policy if exists "editor manage videos" on public.videos;
create policy "public read published articles" on public.articles for select using (status = 'published');
create policy "editor manage articles" on public.articles for all using (public.is_editor()) with check (public.is_editor());
create policy "public read published videos" on public.videos for select using (status = 'published');
create policy "editor manage videos" on public.videos for all using (public.is_editor()) with check (public.is_editor());

create or replace function public.is_editor() returns boolean
language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.profiles where id=auth.uid() and role in ('admin','editor'));
$$;

-- Public counters are deliberately exposed only through SECURITY DEFINER RPCs.
revoke all on function public.increment_article_views(uuid) from public;
revoke all on function public.increment_article_likes(uuid) from public;
revoke all on function public.increment_video_views(uuid) from public;
revoke all on function public.increment_video_likes(uuid) from public;
revoke all on function public.increment_article_shares(uuid) from public;
revoke all on function public.increment_video_shares(uuid) from public;
grant execute on function public.increment_article_views(uuid) to anon, authenticated;
grant execute on function public.increment_article_likes(uuid) to anon, authenticated;
grant execute on function public.increment_video_views(uuid) to anon, authenticated;
grant execute on function public.increment_video_likes(uuid) to anon, authenticated;
grant execute on function public.increment_article_shares(uuid) to anon, authenticated;
grant execute on function public.increment_video_shares(uuid) to anon, authenticated;

insert into storage.buckets (id,name,public) values ('videos','videos',false) on conflict (id) do nothing;
insert into storage.buckets (id,name,public) values ('thumbnails','thumbnails',true) on conflict (id) do nothing;

-- V4.4 Growth Engine: for an existing DB also run migrations/003_growth_engine.sql.

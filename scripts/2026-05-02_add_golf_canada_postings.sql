create table if not exists public.round_golf_canada_postings (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.rounds(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  posted_at timestamptz not null default timezone('utc', now()),
  posting_method text null default 'manual',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint round_golf_canada_postings_round_user_unique unique (round_id, user_id)
);

create index if not exists round_golf_canada_postings_round_idx
  on public.round_golf_canada_postings(round_id);

create index if not exists round_golf_canada_postings_user_idx
  on public.round_golf_canada_postings(user_id);

alter table public.round_golf_canada_postings enable row level security;

drop policy if exists "golf_canada_postings_self_select" on public.round_golf_canada_postings;
create policy "golf_canada_postings_self_select"
on public.round_golf_canada_postings
for select
using (user_id = auth.uid());

drop policy if exists "golf_canada_postings_self_insert" on public.round_golf_canada_postings;
create policy "golf_canada_postings_self_insert"
on public.round_golf_canada_postings
for insert
with check (user_id = auth.uid());

drop policy if exists "golf_canada_postings_self_update" on public.round_golf_canada_postings;
create policy "golf_canada_postings_self_update"
on public.round_golf_canada_postings
for update
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "golf_canada_postings_self_delete" on public.round_golf_canada_postings;
create policy "golf_canada_postings_self_delete"
on public.round_golf_canada_postings
for delete
using (user_id = auth.uid());

notify pgrst, 'reload schema';

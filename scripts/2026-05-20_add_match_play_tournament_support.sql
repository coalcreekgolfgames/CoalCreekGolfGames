create table if not exists public.tournament_matches (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  bracket_round integer null,
  bracket_position integer null,
  match_type text not null default 'singles',
  status text not null default 'scheduled',
  player_a_participant_id uuid null references public.tournament_players(id) on delete set null,
  player_b_participant_id uuid null references public.tournament_players(id) on delete set null,
  player_a_playing_handicap numeric null,
  player_b_playing_handicap numeric null,
  scoring_mode text not null default 'net',
  handicap_mode text not null default 'full_difference',
  tie_handling text not null default 'sudden_death_playoff',
  winner_participant_id uuid null references public.tournament_players(id) on delete set null,
  current_leader_participant_id uuid null references public.tournament_players(id) on delete set null,
  current_margin integer null,
  holes_remaining integer null,
  final_result_label text null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint tournament_matches_status_check
    check (status in ('scheduled', 'active', 'complete', 'conceded', 'tied', 'cancelled')),
  constraint tournament_matches_match_type_check
    check (match_type in ('singles', 'bracket')),
  constraint tournament_matches_scoring_mode_check
    check (scoring_mode in ('gross', 'net')),
  constraint tournament_matches_handicap_mode_check
    check (handicap_mode in ('none', 'full_difference')),
  constraint tournament_matches_tie_handling_check
    check (tie_handling in ('sudden_death_playoff', 'committee_decision', 'allow_tie'))
);

create index if not exists tournament_matches_tournament_idx
  on public.tournament_matches(tournament_id);

create index if not exists tournament_matches_status_idx
  on public.tournament_matches(status);

create index if not exists tournament_matches_bracket_idx
  on public.tournament_matches(tournament_id, bracket_round, bracket_position);

create table if not exists public.tournament_match_holes (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.tournament_matches(id) on delete cascade,
  hole_number integer not null,
  par integer null,
  stroke_index integer null,
  player_a_gross integer null,
  player_b_gross integer null,
  player_a_strokes_received integer null default 0,
  player_b_strokes_received integer null default 0,
  player_a_net integer null,
  player_b_net integer null,
  hole_result text null,
  concession_type text null default 'none',
  match_status_after_hole text null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint tournament_match_holes_match_hole_unique unique (match_id, hole_number),
  constraint tournament_match_holes_result_check
    check (hole_result in ('a', 'b', 'halved') or hole_result is null),
  constraint tournament_match_holes_concession_type_check
    check (concession_type in ('none', 'stroke', 'hole', 'match') or concession_type is null)
);

create index if not exists tournament_match_holes_match_idx
  on public.tournament_match_holes(match_id);

alter table public.tournament_matches enable row level security;
alter table public.tournament_match_holes enable row level security;

drop policy if exists "tournament_matches_member_select" on public.tournament_matches;
create policy "tournament_matches_member_select"
on public.tournament_matches
for select
using (
  exists (
    select 1
    from public.tournament_players tp
    where tp.tournament_id = tournament_matches.tournament_id
      and tp.user_id = auth.uid()
      and tp.is_active = true
  )
);

drop policy if exists "tournament_matches_member_insert" on public.tournament_matches;
create policy "tournament_matches_member_insert"
on public.tournament_matches
for insert
with check (
  exists (
    select 1
    from public.tournament_players tp
    where tp.tournament_id = tournament_matches.tournament_id
      and tp.user_id = auth.uid()
      and tp.is_active = true
  )
);

drop policy if exists "tournament_matches_member_update" on public.tournament_matches;
create policy "tournament_matches_member_update"
on public.tournament_matches
for update
using (
  exists (
    select 1
    from public.tournament_players tp
    where tp.tournament_id = tournament_matches.tournament_id
      and tp.user_id = auth.uid()
      and tp.is_active = true
  )
)
with check (
  exists (
    select 1
    from public.tournament_players tp
    where tp.tournament_id = tournament_matches.tournament_id
      and tp.user_id = auth.uid()
      and tp.is_active = true
  )
);

drop policy if exists "tournament_matches_member_delete" on public.tournament_matches;
create policy "tournament_matches_member_delete"
on public.tournament_matches
for delete
using (
  exists (
    select 1
    from public.tournament_players tp
    where tp.tournament_id = tournament_matches.tournament_id
      and tp.user_id = auth.uid()
      and tp.is_active = true
  )
);

drop policy if exists "tournament_match_holes_member_select" on public.tournament_match_holes;
create policy "tournament_match_holes_member_select"
on public.tournament_match_holes
for select
using (
  exists (
    select 1
    from public.tournament_matches tm
    join public.tournament_players tp
      on tp.tournament_id = tm.tournament_id
    where tm.id = tournament_match_holes.match_id
      and tp.user_id = auth.uid()
      and tp.is_active = true
  )
);

drop policy if exists "tournament_match_holes_member_insert" on public.tournament_match_holes;
create policy "tournament_match_holes_member_insert"
on public.tournament_match_holes
for insert
with check (
  exists (
    select 1
    from public.tournament_matches tm
    join public.tournament_players tp
      on tp.tournament_id = tm.tournament_id
    where tm.id = tournament_match_holes.match_id
      and tp.user_id = auth.uid()
      and tp.is_active = true
  )
);

drop policy if exists "tournament_match_holes_member_update" on public.tournament_match_holes;
create policy "tournament_match_holes_member_update"
on public.tournament_match_holes
for update
using (
  exists (
    select 1
    from public.tournament_matches tm
    join public.tournament_players tp
      on tp.tournament_id = tm.tournament_id
    where tm.id = tournament_match_holes.match_id
      and tp.user_id = auth.uid()
      and tp.is_active = true
  )
)
with check (
  exists (
    select 1
    from public.tournament_matches tm
    join public.tournament_players tp
      on tp.tournament_id = tm.tournament_id
    where tm.id = tournament_match_holes.match_id
      and tp.user_id = auth.uid()
      and tp.is_active = true
  )
);

drop policy if exists "tournament_match_holes_member_delete" on public.tournament_match_holes;
create policy "tournament_match_holes_member_delete"
on public.tournament_match_holes
for delete
using (
  exists (
    select 1
    from public.tournament_matches tm
    join public.tournament_players tp
      on tp.tournament_id = tm.tournament_id
    where tm.id = tournament_match_holes.match_id
      and tp.user_id = auth.uid()
      and tp.is_active = true
  )
);

notify pgrst, 'reload schema';

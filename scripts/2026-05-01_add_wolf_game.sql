create table if not exists public.round_game_wolf_holes (
  id uuid primary key default gen_random_uuid(),
  round_game_id uuid not null references public.round_games(id) on delete cascade,
  hole_number integer not null check (hole_number between 1 and 18),
  wolf_participant_id text not null,
  partner_participant_id text null,
  is_lone_wolf boolean not null default false,
  wolf_side_score integer null,
  hunters_side_score integer null,
  winning_side text null check (winning_side in ('wolf_side', 'hunters', 'tie')),
  points_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint round_game_wolf_holes_round_hole_unique unique (round_game_id, hole_number),
  constraint round_game_wolf_holes_wolf_participant_check check (length(trim(wolf_participant_id)) > 0),
  constraint round_game_wolf_holes_partner_check check (
    partner_participant_id is null or length(trim(partner_participant_id)) > 0
  ),
  constraint round_game_wolf_holes_lone_partner_check check (
    (is_lone_wolf = true and partner_participant_id is null)
    or is_lone_wolf = false
  )
);

create table if not exists public.round_game_wolf_hole_scores (
  id uuid primary key default gen_random_uuid(),
  round_game_id uuid not null references public.round_games(id) on delete cascade,
  hole_number integer not null check (hole_number between 1 and 18),
  participant_id text not null,
  score integer not null check (score > 0),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint round_game_wolf_hole_scores_round_hole_participant_unique unique (round_game_id, hole_number, participant_id),
  constraint round_game_wolf_hole_scores_participant_check check (length(trim(participant_id)) > 0)
);

create index if not exists round_game_wolf_holes_round_game_hole_idx
  on public.round_game_wolf_holes(round_game_id, hole_number);

create index if not exists round_game_wolf_hole_scores_round_game_hole_idx
  on public.round_game_wolf_hole_scores(round_game_id, hole_number);

create index if not exists round_game_wolf_hole_scores_round_game_participant_idx
  on public.round_game_wolf_hole_scores(round_game_id, participant_id);

alter table public.round_game_wolf_holes enable row level security;
alter table public.round_game_wolf_hole_scores enable row level security;

drop policy if exists "wolf_holes_owner_select" on public.round_game_wolf_holes;
create policy "wolf_holes_owner_select"
on public.round_game_wolf_holes
for select
using (
  exists (
    select 1
    from public.round_games rg
    where rg.id = round_game_id
      and rg.created_by_user_id = auth.uid()
  )
);

drop policy if exists "wolf_holes_owner_insert" on public.round_game_wolf_holes;
create policy "wolf_holes_owner_insert"
on public.round_game_wolf_holes
for insert
with check (
  exists (
    select 1
    from public.round_games rg
    where rg.id = round_game_id
      and rg.created_by_user_id = auth.uid()
  )
);

drop policy if exists "wolf_holes_owner_update" on public.round_game_wolf_holes;
create policy "wolf_holes_owner_update"
on public.round_game_wolf_holes
for update
using (
  exists (
    select 1
    from public.round_games rg
    where rg.id = round_game_id
      and rg.created_by_user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.round_games rg
    where rg.id = round_game_id
      and rg.created_by_user_id = auth.uid()
  )
);

drop policy if exists "wolf_holes_owner_delete" on public.round_game_wolf_holes;
create policy "wolf_holes_owner_delete"
on public.round_game_wolf_holes
for delete
using (
  exists (
    select 1
    from public.round_games rg
    where rg.id = round_game_id
      and rg.created_by_user_id = auth.uid()
  )
);

drop policy if exists "wolf_hole_scores_owner_select" on public.round_game_wolf_hole_scores;
create policy "wolf_hole_scores_owner_select"
on public.round_game_wolf_hole_scores
for select
using (
  exists (
    select 1
    from public.round_games rg
    where rg.id = round_game_id
      and rg.created_by_user_id = auth.uid()
  )
);

drop policy if exists "wolf_hole_scores_owner_insert" on public.round_game_wolf_hole_scores;
create policy "wolf_hole_scores_owner_insert"
on public.round_game_wolf_hole_scores
for insert
with check (
  exists (
    select 1
    from public.round_games rg
    where rg.id = round_game_id
      and rg.created_by_user_id = auth.uid()
  )
);

drop policy if exists "wolf_hole_scores_owner_update" on public.round_game_wolf_hole_scores;
create policy "wolf_hole_scores_owner_update"
on public.round_game_wolf_hole_scores
for update
using (
  exists (
    select 1
    from public.round_games rg
    where rg.id = round_game_id
      and rg.created_by_user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.round_games rg
    where rg.id = round_game_id
      and rg.created_by_user_id = auth.uid()
  )
);

drop policy if exists "wolf_hole_scores_owner_delete" on public.round_game_wolf_hole_scores;
create policy "wolf_hole_scores_owner_delete"
on public.round_game_wolf_hole_scores
for delete
using (
  exists (
    select 1
    from public.round_games rg
    where rg.id = round_game_id
      and rg.created_by_user_id = auth.uid()
  )
);

create or replace view public.v_round_game_wolf_hole_history as
select
  rgwh.round_game_id,
  rg.round_id,
  rgwh.hole_number,
  rgwh.wolf_participant_id,
  rgwh.partner_participant_id,
  rgwh.is_lone_wolf,
  rgwh.wolf_side_score,
  rgwh.hunters_side_score,
  rgwh.winning_side,
  rgwh.points_json,
  rgwhs.participant_id,
  rgp.display_name,
  rgp.user_id,
  rgp.seat_order,
  rgwhs.score
from public.round_game_wolf_holes rgwh
join public.round_games rg
  on rg.id = rgwh.round_game_id
left join public.round_game_wolf_hole_scores rgwhs
  on rgwhs.round_game_id = rgwh.round_game_id
 and rgwhs.hole_number = rgwh.hole_number
left join public.round_game_participants rgp
  on rgp.round_game_id = rgwh.round_game_id
 and rgp.participant_id = rgwhs.participant_id;

create or replace view public.v_round_game_wolf_live_standings as
with point_rows as (
  select
    rgwh.round_game_id,
    rg.round_id,
    rgp.participant_id,
    rgp.display_name,
    rgp.user_id,
    rgp.seat_order,
    coalesce(sum((rgwh.points_json ->> rgp.participant_id)::integer), 0) as total_points,
    count(distinct rgwh.hole_number) as holes_complete
  from public.round_game_wolf_holes rgwh
  join public.round_games rg
    on rg.id = rgwh.round_game_id
  join public.round_game_participants rgp
    on rgp.round_game_id = rgwh.round_game_id
  where rgp.is_active = true
  group by rgwh.round_game_id, rg.round_id, rgp.participant_id, rgp.display_name, rgp.user_id, rgp.seat_order
),
gross_rows as (
  select
    round_game_id,
    participant_id,
    sum(score) as gross_total
  from public.round_game_wolf_hole_scores
  group by round_game_id, participant_id
)
select
  pr.round_game_id,
  pr.round_id,
  pr.participant_id,
  pr.display_name,
  pr.user_id,
  pr.seat_order,
  pr.total_points,
  pr.holes_complete,
  gr.gross_total
from point_rows pr
left join gross_rows gr
  on gr.round_game_id = pr.round_game_id
 and gr.participant_id = pr.participant_id
order by pr.round_game_id, pr.total_points desc, pr.seat_order asc nulls last, pr.display_name asc;

notify pgrst, 'reload schema';

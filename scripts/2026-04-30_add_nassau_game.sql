create table if not exists public.round_game_nassau_holes (
  id uuid primary key default gen_random_uuid(),
  round_game_id uuid not null references public.round_games(id) on delete cascade,
  hole_number integer not null,
  winner_participant_id text null,
  winning_score integer null,
  is_halved boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint round_game_nassau_holes_round_hole_unique unique (round_game_id, hole_number),
  constraint round_game_nassau_holes_hole_number_check check (hole_number between 1 and 18),
  constraint round_game_nassau_holes_winning_score_check check (winning_score is null or winning_score > 0),
  constraint round_game_nassau_holes_halved_winner_check check (
    (is_halved = true and winner_participant_id is null)
    or is_halved = false
  )
);

create table if not exists public.round_game_nassau_hole_scores (
  id uuid primary key default gen_random_uuid(),
  round_game_nassau_hole_id uuid not null references public.round_game_nassau_holes(id) on delete cascade,
  participant_id text not null,
  score integer not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint round_game_nassau_hole_scores_hole_participant_unique unique (round_game_nassau_hole_id, participant_id),
  constraint round_game_nassau_hole_scores_participant_check check (length(trim(participant_id)) > 0),
  constraint round_game_nassau_hole_scores_score_check check (score > 0)
);

create index if not exists round_game_nassau_holes_round_game_hole_idx
  on public.round_game_nassau_holes(round_game_id, hole_number);

create index if not exists round_game_nassau_hole_scores_hole_idx
  on public.round_game_nassau_hole_scores(round_game_nassau_hole_id);

create index if not exists round_game_nassau_hole_scores_participant_idx
  on public.round_game_nassau_hole_scores(participant_id);

alter table public.round_game_nassau_holes enable row level security;
alter table public.round_game_nassau_hole_scores enable row level security;

drop policy if exists "nassau_holes_owner_select" on public.round_game_nassau_holes;
create policy "nassau_holes_owner_select"
on public.round_game_nassau_holes
for select
using (
  exists (
    select 1
    from public.round_games rg
    where rg.id = round_game_id
      and rg.created_by_user_id = auth.uid()
  )
);

drop policy if exists "nassau_holes_owner_insert" on public.round_game_nassau_holes;
create policy "nassau_holes_owner_insert"
on public.round_game_nassau_holes
for insert
with check (
  exists (
    select 1
    from public.round_games rg
    where rg.id = round_game_id
      and rg.created_by_user_id = auth.uid()
  )
);

drop policy if exists "nassau_holes_owner_update" on public.round_game_nassau_holes;
create policy "nassau_holes_owner_update"
on public.round_game_nassau_holes
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

drop policy if exists "nassau_holes_owner_delete" on public.round_game_nassau_holes;
create policy "nassau_holes_owner_delete"
on public.round_game_nassau_holes
for delete
using (
  exists (
    select 1
    from public.round_games rg
    where rg.id = round_game_id
      and rg.created_by_user_id = auth.uid()
  )
);

drop policy if exists "nassau_hole_scores_owner_select" on public.round_game_nassau_hole_scores;
create policy "nassau_hole_scores_owner_select"
on public.round_game_nassau_hole_scores
for select
using (
  exists (
    select 1
    from public.round_game_nassau_holes ngh
    join public.round_games rg on rg.id = ngh.round_game_id
    where ngh.id = round_game_nassau_hole_id
      and rg.created_by_user_id = auth.uid()
  )
);

drop policy if exists "nassau_hole_scores_owner_insert" on public.round_game_nassau_hole_scores;
create policy "nassau_hole_scores_owner_insert"
on public.round_game_nassau_hole_scores
for insert
with check (
  exists (
    select 1
    from public.round_game_nassau_holes ngh
    join public.round_games rg on rg.id = ngh.round_game_id
    where ngh.id = round_game_nassau_hole_id
      and rg.created_by_user_id = auth.uid()
  )
);

drop policy if exists "nassau_hole_scores_owner_update" on public.round_game_nassau_hole_scores;
create policy "nassau_hole_scores_owner_update"
on public.round_game_nassau_hole_scores
for update
using (
  exists (
    select 1
    from public.round_game_nassau_holes ngh
    join public.round_games rg on rg.id = ngh.round_game_id
    where ngh.id = round_game_nassau_hole_id
      and rg.created_by_user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.round_game_nassau_holes ngh
    join public.round_games rg on rg.id = ngh.round_game_id
    where ngh.id = round_game_nassau_hole_id
      and rg.created_by_user_id = auth.uid()
  )
);

drop policy if exists "nassau_hole_scores_owner_delete" on public.round_game_nassau_hole_scores;
create policy "nassau_hole_scores_owner_delete"
on public.round_game_nassau_hole_scores
for delete
using (
  exists (
    select 1
    from public.round_game_nassau_holes ngh
    join public.round_games rg on rg.id = ngh.round_game_id
    where ngh.id = round_game_nassau_hole_id
      and rg.created_by_user_id = auth.uid()
  )
);

create or replace view public.v_round_game_nassau_hole_history as
select
  rgnh.round_game_id,
  rg.round_id,
  rgnh.hole_number,
  rgnh.winner_participant_id,
  rgnh.winning_score,
  rgnh.is_halved,
  rgnhs.participant_id,
  rgp.display_name,
  rgp.user_id,
  rgp.seat_order,
  rgnhs.score
from public.round_game_nassau_holes rgnh
join public.round_games rg
  on rg.id = rgnh.round_game_id
left join public.round_game_nassau_hole_scores rgnhs
  on rgnhs.round_game_nassau_hole_id = rgnh.id
left join public.round_game_participants rgp
  on rgp.round_game_id = rgnh.round_game_id
 and rgp.participant_id = rgnhs.participant_id;

create or replace view public.v_round_game_nassau_live_standings as
with hole_base as (
  select
    rgnh.round_game_id,
    rg.round_id,
    rgnh.hole_number,
    rgnh.winner_participant_id,
    rgnh.is_halved,
    rgnhs.participant_id,
    rgp.display_name,
    rgp.user_id,
    rgp.seat_order,
    rgnhs.score
  from public.round_game_nassau_holes rgnh
  join public.round_games rg
    on rg.id = rgnh.round_game_id
  join public.round_game_nassau_hole_scores rgnhs
    on rgnhs.round_game_nassau_hole_id = rgnh.id
  left join public.round_game_participants rgp
    on rgp.round_game_id = rgnh.round_game_id
   and rgp.participant_id = rgnhs.participant_id
),
hole_totals as (
  select
    round_game_id,
    round_id,
    participant_id,
    display_name,
    user_id,
    seat_order,
    count(distinct hole_number) as holes_complete,
    sum(case when hole_number between 1 and 9 and winner_participant_id = participant_id then 1
             when hole_number between 1 and 9 and is_halved then 0
             else 0 end) as front_wins,
    sum(case when hole_number between 10 and 18 and winner_participant_id = participant_id then 1
             when hole_number between 10 and 18 and is_halved then 0
             else 0 end) as back_wins,
    sum(case when winner_participant_id = participant_id then 1
             when is_halved then 0
             else 0 end) as overall_wins,
    sum(score) as gross_total
  from hole_base
  group by round_game_id, round_id, participant_id, display_name, user_id, seat_order
),
hole_opponents as (
  select
    a.round_game_id,
    a.round_id,
    a.participant_id,
    b.participant_id as opponent_participant_id,
    sum(case when a.hole_number between 1 and 9 and b.winner_participant_id = b.participant_id then 1
             when a.hole_number between 1 and 9 and b.is_halved then 0
             else 0 end) as front_losses,
    sum(case when a.hole_number between 10 and 18 and b.winner_participant_id = b.participant_id then 1
             when a.hole_number between 10 and 18 and b.is_halved then 0
             else 0 end) as back_losses,
    sum(case when b.winner_participant_id = b.participant_id then 1
             when b.is_halved then 0
             else 0 end) as overall_losses
  from hole_base a
  join hole_base b
    on a.round_game_id = b.round_game_id
   and a.hole_number = b.hole_number
   and a.participant_id <> b.participant_id
  group by a.round_game_id, a.round_id, a.participant_id, b.participant_id
)
select
  ht.round_game_id,
  ht.round_id,
  ht.participant_id,
  ht.display_name,
  ht.user_id,
  ht.seat_order,
  ht.holes_complete,
  coalesce(ht.front_wins, 0) - coalesce(ho.front_losses, 0) as front_net,
  coalesce(ht.back_wins, 0) - coalesce(ho.back_losses, 0) as back_net,
  coalesce(ht.overall_wins, 0) - coalesce(ho.overall_losses, 0) as overall_net,
  ht.gross_total
from hole_totals ht
left join hole_opponents ho
  on ho.round_game_id = ht.round_game_id
 and ho.round_id = ht.round_id
 and ho.participant_id = ht.participant_id;

-- After running this script, run:
-- notify pgrst, 'reload schema';

alter table public.hole_scores
  add column if not exists participant_id uuid null references public.round_participants(id) on delete cascade;

create index if not exists hole_scores_round_participant_idx
  on public.hole_scores(round_id, participant_id, hole_number);

create unique index if not exists hole_scores_round_participant_hole_unique
  on public.hole_scores(round_id, participant_id, hole_number)
  where participant_id is not null;

update public.hole_scores hs
set participant_id = rp.id
from public.round_participants rp
where hs.round_id = rp.round_id
  and hs.participant_id is null
  and rp.user_id is not null
  and hs.user_id = rp.user_id;

drop function if exists public.sync_standard_group_participant_hole_mirror(uuid, integer);

create or replace function public.sync_standard_group_participant_hole_mirror(
  p_round_id uuid,
  p_hole_number integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Not authenticated'
      using errcode = 'P0001';
  end if;

  if not exists (
    select 1
    from public.rounds r
    where r.id = p_round_id
      and (r.created_by_user_id = v_user_id or r.scoring_user_id = v_user_id)
  ) then
    raise exception 'You do not have access to sync this round.'
      using errcode = 'P0003';
  end if;

  update public.round_participants rp
  set gross_total = coalesce(rollup.gross_total, 0)
  from (
    select
      rp_inner.id as round_participant_id,
      sum(case when hs.strokes is not null and hs.strokes > 0 then hs.strokes else 0 end)::int as gross_total
    from public.round_participants rp_inner
    left join public.hole_scores hs
      on hs.round_id = rp_inner.round_id
     and (
       hs.participant_id = rp_inner.id
       or (
         hs.participant_id is null
         and rp_inner.user_id is not null
         and hs.user_id = rp_inner.user_id
       )
     )
    where rp_inner.round_id = p_round_id
    group by rp_inner.id
  ) rollup
  where rp.id = rollup.round_participant_id;

  update public.round_players rpl
  set gross_total = coalesce(rollup.gross_total, 0)
  from (
    select
      rp.user_id,
      sum(case when hs.strokes is not null and hs.strokes > 0 then hs.strokes else 0 end)::int as gross_total
    from public.round_participants rp
    left join public.hole_scores hs
      on hs.round_id = rp.round_id
     and (
       hs.participant_id = rp.id
       or (
         hs.participant_id is null
         and rp.user_id is not null
         and hs.user_id = rp.user_id
       )
     )
    where rp.round_id = p_round_id
      and rp.user_id is not null
    group by rp.user_id
  ) rollup
  where rpl.round_id = p_round_id
    and rpl.user_id = rollup.user_id;
end;
$$;

grant execute on function public.sync_standard_group_participant_hole_mirror(uuid, integer) to authenticated;

drop function if exists public.get_standard_group_live_board(uuid);

create or replace function public.get_standard_group_live_board(p_round_id uuid)
returns table (
  round_id uuid,
  round_participant_id uuid,
  user_id uuid,
  guest_profile_id uuid,
  display_name text,
  participant_order integer,
  is_scorer boolean,
  holes_completed integer,
  gross_total integer,
  hole_score_row_count integer,
  standing_rank bigint
)
language sql
security definer
set search_path = public
as $$
with me as (
  select auth.uid() as user_id
),
allowed_round as (
  select r.*
  from public.rounds r
  cross join me
  where r.id = p_round_id
    and me.user_id is not null
    and (
      r.created_by_user_id = me.user_id
      or r.scoring_user_id = me.user_id
      or exists (
        select 1
        from public.round_participants rp
        where rp.round_id = r.id
          and rp.user_id = me.user_id
      )
    )
),
official_scores as (
  select
    rp.id as round_participant_id,
    hs.hole_number,
    hs.strokes
  from public.round_participants rp
  join allowed_round ar
    on ar.id = rp.round_id
  left join public.hole_scores hs
    on hs.round_id = rp.round_id
   and hs.strokes is not null
   and (
     hs.participant_id = rp.id
     or (
       hs.participant_id is null
       and rp.user_id is not null
       and hs.user_id = rp.user_id
     )
   )
),
rollup as (
  select
    rp.id as round_participant_id,
    rp.round_id,
    rp.user_id,
    rp.guest_profile_id,
    coalesce(
      nullif(trim(concat_ws(' ', p.first_name, p.last_name)), ''),
      nullif(trim(concat_ws(' ', rp.guest_first_name, rp.guest_last_name)), ''),
      'Player'
    )::text as display_name,
    rp.participant_order::int as participant_order,
    coalesce(rp.is_scorer, false) as is_scorer,
    count(distinct case when os.strokes is not null and os.strokes > 0 then os.hole_number end)::int as holes_completed,
    coalesce(sum(case when os.strokes is not null and os.strokes > 0 then os.strokes else 0 end), 0)::int as gross_total
  from public.round_participants rp
  join allowed_round ar
    on ar.id = rp.round_id
  left join public.profiles p
    on p.id = rp.user_id
  left join official_scores os
    on os.round_participant_id = rp.id
  group by
    rp.id,
    rp.round_id,
    rp.user_id,
    rp.guest_profile_id,
    p.first_name,
    p.last_name,
    rp.guest_first_name,
    rp.guest_last_name,
    rp.participant_order,
    rp.is_scorer
)
select
  rollup.round_id,
  rollup.round_participant_id,
  rollup.user_id,
  rollup.guest_profile_id,
  rollup.display_name,
  rollup.participant_order,
  rollup.is_scorer,
  rollup.holes_completed,
  rollup.gross_total,
  (
    select count(*)
    from official_scores os
    where os.strokes is not null and os.strokes > 0
  )::int as hole_score_row_count,
  rank() over (
    order by
      rollup.holes_completed desc,
      case when rollup.holes_completed > 0 then rollup.gross_total else 2147483647 end asc,
      rollup.participant_order asc nulls last,
      rollup.display_name asc
  ) as standing_rank
from rollup
order by standing_rank asc, participant_order asc nulls last, display_name asc;
$$;

grant execute on function public.get_standard_group_live_board(uuid) to authenticated;

drop function if exists public.get_standard_round_hole_scorecard(uuid);

create function public.get_standard_round_hole_scorecard(p_round_id uuid)
returns table (
  round_id uuid,
  round_mode text,
  status text,
  course_name text,
  round_date date,
  round_participant_id uuid,
  participant_order integer,
  user_id uuid,
  guest_profile_id uuid,
  guest_first_name text,
  guest_last_name text,
  display_name text,
  is_scorer boolean,
  hole_number integer,
  strokes integer,
  participant_total_score integer,
  participant_holes_complete integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_round public.rounds%rowtype;
  v_allowed boolean := false;
begin
  if v_user_id is null then
    raise exception 'Not authenticated'
      using errcode = 'P0001';
  end if;

  select *
  into v_round
  from public.rounds r
  where r.id = p_round_id;

  if not found then
    raise exception 'Round not found'
      using errcode = 'P0002';
  end if;

  select exists (
    select 1
    from public.round_participants rp
    where rp.round_id = p_round_id
      and rp.user_id = v_user_id
  )
  or exists (
    select 1
    from public.hole_scores hs
    where hs.round_id = p_round_id
      and hs.user_id = v_user_id
      and hs.strokes is not null
  )
  or v_round.created_by_user_id = v_user_id
  or v_round.scoring_user_id = v_user_id
  into v_allowed;

  if not v_allowed then
    raise exception 'You do not have access to this round scorecard.'
      using errcode = 'P0003';
  end if;

  return query
  with participant_rollup as (
    select
      rp.id as round_participant_id,
      coalesce(sum(case when hs.strokes is not null and hs.strokes > 0 then hs.strokes else 0 end), rp.gross_total, 0)::int as participant_total_score,
      count(distinct case when hs.strokes is not null and hs.strokes > 0 then hs.hole_number end)::int as participant_holes_complete
    from public.round_participants rp
    left join public.hole_scores hs
      on hs.round_id = rp.round_id
     and (
       hs.participant_id = rp.id
       or (
         hs.participant_id is null
         and rp.user_id is not null
         and hs.user_id = rp.user_id
       )
     )
    where rp.round_id = p_round_id
    group by rp.id, rp.gross_total
  )
  select
    v_round.id as round_id,
    v_round.round_mode::text as round_mode,
    v_round.status::text as status,
    v_round.course_name::text as course_name,
    v_round.round_date as round_date,
    rp.id as round_participant_id,
    rp.participant_order::int as participant_order,
    rp.user_id,
    rp.guest_profile_id,
    rp.guest_first_name::text,
    rp.guest_last_name::text,
    coalesce(
      nullif(trim(concat_ws(' ', p.first_name, p.last_name)), ''),
      nullif(trim(concat_ws(' ', rp.guest_first_name, rp.guest_last_name)), ''),
      'Player'
    )::text as display_name,
    coalesce(rp.is_scorer, false) as is_scorer,
    hs.hole_number::int as hole_number,
    hs.strokes::int as strokes,
    pr.participant_total_score,
    pr.participant_holes_complete
  from public.round_participants rp
  left join public.profiles p
    on p.id = rp.user_id
  left join public.hole_scores hs
    on hs.round_id = rp.round_id
   and hs.strokes is not null
   and (
     hs.participant_id = rp.id
     or (
       hs.participant_id is null
       and rp.user_id is not null
       and hs.user_id = rp.user_id
     )
   )
  left join participant_rollup pr
    on pr.round_participant_id = rp.id
  where rp.round_id = p_round_id
  order by rp.participant_order asc nulls last, hs.hole_number asc nulls first;
end;
$$;

grant execute on function public.get_standard_round_hole_scorecard(uuid) to authenticated;

drop function if exists public.get_standard_round_history_detail(uuid);

create function public.get_standard_round_history_detail(p_round_id uuid)
returns table (
  round_id uuid,
  round_mode text,
  status text,
  course_name text,
  round_date date,
  current_user_score integer,
  holes_complete integer,
  is_creator boolean,
  is_scoring_user boolean,
  is_participant boolean,
  has_hole_scores boolean,
  hole_number integer,
  strokes integer,
  display_name text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_round public.rounds%rowtype;
  v_is_creator boolean := false;
  v_is_scoring_user boolean := false;
  v_is_participant boolean := false;
  v_has_hole_scores boolean := false;
  v_display_name text := 'Player';
  v_current_user_score integer := 0;
  v_holes_complete integer := 0;
  v_participant_id uuid := null;
begin
  if v_user_id is null then
    raise exception 'Not authenticated'
      using errcode = 'P0001';
  end if;

  select *
  into v_round
  from public.rounds r
  where r.id = p_round_id;

  if not found then
    raise exception 'Round not found'
      using errcode = 'P0002';
  end if;

  v_is_creator := v_round.created_by_user_id = v_user_id;
  v_is_scoring_user := v_round.scoring_user_id = v_user_id;

  select rp.id
  into v_participant_id
  from public.round_participants rp
  where rp.round_id = p_round_id
    and rp.user_id = v_user_id
  order by rp.participant_order asc nulls last, rp.id asc
  limit 1;

  v_is_participant := v_participant_id is not null;

  select exists (
    select 1
    from public.hole_scores hs
    where hs.round_id = p_round_id
      and (
        hs.user_id = v_user_id
        or (v_participant_id is not null and hs.participant_id = v_participant_id)
      )
      and hs.strokes is not null
  )
  into v_has_hole_scores;

  if not (v_is_creator or v_is_scoring_user or v_is_participant or v_has_hole_scores) then
    raise exception 'You do not have access to this round history.'
      using errcode = 'P0003';
  end if;

  select
    coalesce(sum(hs.strokes), 0)::int,
    count(distinct hs.hole_number)::int
  into
    v_current_user_score,
    v_holes_complete
  from public.hole_scores hs
  where hs.round_id = p_round_id
    and (
      (v_participant_id is not null and hs.participant_id = v_participant_id)
      or (v_participant_id is null and hs.user_id = v_user_id)
    )
    and hs.strokes is not null;

  select
    coalesce(
      nullif(trim(concat_ws(' ', p.first_name, p.last_name)), ''),
      'Player'
    )
  into v_display_name
  from public.profiles p
  where p.id = v_user_id;

  return query
  select
    v_round.id as round_id,
    v_round.round_mode::text as round_mode,
    v_round.status::text as status,
    v_round.course_name::text as course_name,
    v_round.round_date as round_date,
    v_current_user_score as current_user_score,
    v_holes_complete as holes_complete,
    v_is_creator as is_creator,
    v_is_scoring_user as is_scoring_user,
    v_is_participant as is_participant,
    v_has_hole_scores as has_hole_scores,
    hs.hole_number::int as hole_number,
    hs.strokes::int as strokes,
    v_display_name as display_name
  from public.hole_scores hs
  where hs.round_id = p_round_id
    and (
      (v_participant_id is not null and hs.participant_id = v_participant_id)
      or (v_participant_id is null and hs.user_id = v_user_id)
    )
    and hs.strokes is not null
  order by hs.hole_number asc;
end;
$$;

grant execute on function public.get_standard_round_history_detail(uuid) to authenticated;

notify pgrst, 'reload schema';

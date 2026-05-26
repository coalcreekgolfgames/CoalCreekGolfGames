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
     and hs.user_id = rp.user_id
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
   and hs.user_id = rp.user_id
   and hs.strokes is not null
  left join participant_rollup pr
    on pr.round_participant_id = rp.id
  where rp.round_id = p_round_id
  order by rp.participant_order asc nulls last, hs.hole_number asc nulls first;
end;
$$;

grant execute on function public.get_standard_round_hole_scorecard(uuid) to authenticated;

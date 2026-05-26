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

  select exists (
    select 1
    from public.round_participants rp
    where rp.round_id = p_round_id
      and rp.user_id = v_user_id
  )
  into v_is_participant;

  select exists (
    select 1
    from public.hole_scores hs
    where hs.round_id = p_round_id
      and hs.user_id = v_user_id
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
    and hs.user_id = v_user_id
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
    and hs.user_id = v_user_id
    and hs.strokes is not null
  order by hs.hole_number asc;
end;
$$;

grant execute on function public.get_standard_round_history_detail(uuid) to authenticated;

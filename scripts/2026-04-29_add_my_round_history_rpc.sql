drop function if exists public.get_my_round_history();
drop function if exists public.get_round_history_for_user(uuid);

create or replace function public.get_my_round_history()
returns table (
  round_id uuid,
  round_game_id uuid,
  game_type text,
  round_mode text,
  status text,
  course_name text,
  round_date date,
  created_at timestamptz,
  updated_at timestamptz,
  current_user_score integer,
  holes_complete integer,
  hole_score_row_count integer,
  standard_score integer,
  standard_holes_complete integer,
  standard_hole_score_count integer,
  game_score integer,
  game_holes_complete integer,
  game_hole_score_count integer,
  selected_score_source text,
  is_participant boolean,
  is_scorer boolean,
  participant_count integer,
  player_count integer
)
language sql
security definer
set search_path = public
as $$
with me as (
  select auth.uid() as user_id
),
participant_rollup as (
  select
    rp.round_id,
    bool_or(rp.user_id = me.user_id) as is_participant,
    bool_or(rp.user_id = me.user_id and coalesce(rp.is_scorer, false)) as is_scorer,
    count(*)::int as participant_count,
    max(case when rp.user_id = me.user_id then rp.gross_total end)::int as participant_gross_total
  from public.round_participants rp
  cross join me
  group by rp.round_id
),
score_rollup as (
  select
    hs.round_id,
    sum(case when hs.user_id = me.user_id then coalesce(hs.strokes, 0) else 0 end)::int as current_user_score,
    count(distinct case when hs.user_id = me.user_id and hs.strokes is not null then hs.hole_number end)::int as holes_complete,
    count(case when hs.user_id = me.user_id and hs.strokes is not null and hs.strokes > 0 then 1 end)::int as hole_score_row_count,
    bool_or(hs.user_id = me.user_id) as has_user_scores
  from public.hole_scores hs
  cross join me
  group by hs.round_id
),
eligible_rounds as (
  select
    r.id,
    r.round_mode,
    r.status,
    r.course_name,
    r.round_date,
    r.created_at,
    r.updated_at,
    r.created_by_user_id,
    r.scoring_user_id,
    r.player_count::int as player_count,
    coalesce(pr.is_participant, false) as is_participant,
    coalesce(pr.is_scorer, false) as is_scorer,
    coalesce(pr.participant_count, 0) as participant_count,
    coalesce(sr.current_user_score, pr.participant_gross_total) as current_user_score,
    coalesce(sr.holes_complete, 0) as holes_complete,
    coalesce(sr.hole_score_row_count, sr.holes_complete, 0) as hole_score_row_count,
    coalesce(sr.has_user_scores, false) as has_user_scores
  from public.rounds r
  cross join me
  left join participant_rollup pr on pr.round_id = r.id
  left join score_rollup sr on sr.round_id = r.id
  where me.user_id is not null
    and (
      r.created_by_user_id = me.user_id
      or r.scoring_user_id = me.user_id
      or coalesce(pr.is_participant, false)
    )
    and (
      coalesce(sr.has_user_scores, false)
      or exists (
        select 1
        from public.round_games rg
        where rg.round_id = r.id
      )
      or coalesce(pr.is_participant, false)
      or r.created_by_user_id = me.user_id
      or r.scoring_user_id = me.user_id
    )
),
selected_games as (
  select
    er.id as round_id,
    rg.id as round_game_id,
    case
      when rg.game_type = 'bingo_bango_bongo' then 'bbb'
      when rg.game_type = 'skins' then 'skins'
      when rg.game_type = 'standard' then 'standard'
      else rg.game_type
    end as game_type,
    rg.updated_at
  from eligible_rounds er
  left join lateral (
    select rg.*
    from public.round_games rg
    where rg.round_id = er.id
    order by
      case
        when lower(coalesce(rg.status, '')) = 'active' then 0
        when lower(coalesce(rg.status, '')) = 'completed' then 1
        else 2
      end asc,
      rg.updated_at desc nulls last,
      rg.created_at desc nulls last
    limit 1
  ) rg on true
),
bbb_game_rollup as (
  select
    sg.round_id,
    sg.round_game_id,
    sum(coalesce(h.score, 0))::int as game_score,
    count(distinct case when h.score is not null and h.score > 0 then h.hole_number end)::int as game_holes_complete,
    count(case when h.score is not null and h.score > 0 then 1 end)::int as game_hole_score_count
  from selected_games sg
  join me on true
  join public.v_round_game_bbb_hole_history h
    on h.round_game_id = sg.round_game_id
  where sg.game_type = 'bbb'
    and h.user_id = me.user_id
  group by sg.round_id, sg.round_game_id
),
skins_game_rollup as (
  select
    sg.round_id,
    sg.round_game_id,
    sum(coalesce(h.score, 0))::int as game_score,
    count(distinct case when h.score is not null and h.score > 0 then h.hole_number end)::int as game_holes_complete,
    count(case when h.score is not null and h.score > 0 then 1 end)::int as game_hole_score_count
  from selected_games sg
  join me on true
  join public.v_round_game_skins_hole_history h
    on h.round_game_id = sg.round_game_id
  where sg.game_type = 'skins'
    and h.user_id = me.user_id
  group by sg.round_id, sg.round_game_id
),
history_rows as (
  select
    er.id as round_id,
    sg.round_game_id,
    coalesce(sg.game_type, 'standard') as game_type,
    er.round_mode,
    er.status,
    er.course_name,
    er.round_date,
    er.created_at,
    greatest(er.updated_at, sg.updated_at) as updated_at,
    case
      when sg.game_type = 'bbb' then coalesce(bgr.game_score, er.current_user_score)
      when sg.game_type = 'skins' then coalesce(sgr.game_score, er.current_user_score)
      else er.current_user_score
    end as current_user_score,
    case
      when sg.game_type = 'bbb' then coalesce(bgr.game_holes_complete, er.holes_complete)
      when sg.game_type = 'skins' then coalesce(sgr.game_holes_complete, er.holes_complete)
      else er.holes_complete
    end as holes_complete,
    case
      when sg.game_type = 'bbb' then coalesce(bgr.game_hole_score_count, er.hole_score_row_count, er.holes_complete)
      when sg.game_type = 'skins' then coalesce(sgr.game_hole_score_count, er.hole_score_row_count, er.holes_complete)
      else coalesce(er.hole_score_row_count, er.holes_complete)
    end as hole_score_row_count,
    er.current_user_score as standard_score,
    er.holes_complete as standard_holes_complete,
    er.hole_score_row_count as standard_hole_score_count,
    case
      when sg.game_type = 'bbb' then bgr.game_score
      when sg.game_type = 'skins' then sgr.game_score
      else null
    end as game_score,
    case
      when sg.game_type = 'bbb' then bgr.game_holes_complete
      when sg.game_type = 'skins' then sgr.game_holes_complete
      else null
    end as game_holes_complete,
    case
      when sg.game_type = 'bbb' then bgr.game_hole_score_count
      when sg.game_type = 'skins' then sgr.game_hole_score_count
      else null
    end as game_hole_score_count,
    case
      when sg.game_type = 'bbb' and bgr.round_game_id is not null then 'bbb_game_scores'
      when sg.game_type = 'skins' and sgr.round_game_id is not null then 'skins_game_scores'
      else 'standard_hole_scores'
    end as selected_score_source,
    er.is_participant,
    er.is_scorer,
    er.participant_count,
    er.player_count
  from eligible_rounds er
  left join selected_games sg
    on sg.round_id = er.id
  left join bbb_game_rollup bgr
    on bgr.round_id = er.id
   and bgr.round_game_id = sg.round_game_id
  left join skins_game_rollup sgr
    on sgr.round_id = er.id
   and sgr.round_game_id = sg.round_game_id
)
select *
from history_rows
order by coalesce(updated_at, created_at) desc, created_at desc, round_id desc;
$$;

grant execute on function public.get_my_round_history() to authenticated;

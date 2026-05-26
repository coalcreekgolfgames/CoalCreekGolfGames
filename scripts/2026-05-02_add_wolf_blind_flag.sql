alter table public.round_game_wolf_holes
add column if not exists is_blind_wolf boolean not null default false;

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
  rgwhs.score,
  rgwh.is_blind_wolf
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
    count(distinct rgwh.hole_number) as holes_complete,
    bool_or(rgwh.is_blind_wolf) as has_blind_wolf_hole
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
  gr.gross_total,
  pr.has_blind_wolf_hole
from point_rows pr
left join gross_rows gr
  on gr.round_game_id = pr.round_game_id
 and gr.participant_id = pr.participant_id
order by pr.round_game_id, pr.total_points desc, pr.seat_order asc nulls last, pr.display_name asc;

notify pgrst, 'reload schema';

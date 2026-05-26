alter table public.hole_scores
  add column if not exists participant_id uuid null references public.round_participants(id) on delete cascade;

update public.hole_scores hs
set participant_id = rp.id
from public.round_participants rp
where hs.participant_id is null
  and hs.round_id = rp.round_id
  and hs.user_id is not null
  and rp.user_id = hs.user_id;

with duplicate_participant_scores as (
  select
    id,
    row_number() over (
      partition by round_id, hole_number, participant_id
      order by updated_at desc nulls last, created_at desc nulls last, id desc
    ) as row_num
  from public.hole_scores
  where participant_id is not null
)
delete from public.hole_scores hs
using duplicate_participant_scores dps
where hs.id = dps.id
  and dps.row_num > 1;

drop index if exists public.hole_scores_round_participant_hole_unique;

create unique index if not exists hole_scores_round_hole_participant_unique
  on public.hole_scores(round_id, hole_number, participant_id);

create index if not exists hole_scores_round_participant_idx
  on public.hole_scores(round_id, participant_id, hole_number);

notify pgrst, 'reload schema';

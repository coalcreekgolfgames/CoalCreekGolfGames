alter table public.hole_scores
  add column if not exists participant_id uuid null references public.round_participants(id) on delete cascade;

alter table public.hole_scores
  alter column user_id drop not null;

alter table public.hole_scores
  drop constraint if exists hole_scores_identity_present_check;

alter table public.hole_scores
  add constraint hole_scores_identity_present_check
  check (user_id is not null or participant_id is not null);

create unique index if not exists hole_scores_round_hole_participant_unique
  on public.hole_scores(round_id, hole_number, participant_id);

create unique index if not exists hole_scores_round_user_hole_unique
  on public.hole_scores(round_id, user_id, hole_number);

notify pgrst, 'reload schema';

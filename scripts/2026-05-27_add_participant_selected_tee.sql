alter table public.round_participants
  add column if not exists selected_tee text;

comment on column public.round_participants.selected_tee is
  'Participant-selected tee set for yardage display and participant scorecard context.';

alter table public.recurring_round_group_members
  add column if not exists selected_tee text;

comment on column public.recurring_round_group_members.selected_tee is
  'Saved tee set for this recurring group member when reused in group round setup.';

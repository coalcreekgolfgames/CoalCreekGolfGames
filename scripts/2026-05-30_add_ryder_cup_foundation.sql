create table if not exists public.tournament_ryder_cup_events (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  competition_id uuid null references public.tournament_competitions(id) on delete set null,
  name text not null default 'Ryder Cup',
  scoring_mode text not null default 'match_points',
  handicap_mode text not null default 'net',
  status text not null default 'draft',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint tournament_ryder_cup_events_scoring_mode_check
    check (scoring_mode in ('match_points')),
  constraint tournament_ryder_cup_events_handicap_mode_check
    check (handicap_mode in ('gross', 'net')),
  constraint tournament_ryder_cup_events_status_check
    check (status in ('draft', 'active', 'completed', 'archived'))
);

create index if not exists tournament_ryder_cup_events_tournament_idx
  on public.tournament_ryder_cup_events(tournament_id);

create index if not exists tournament_ryder_cup_events_competition_idx
  on public.tournament_ryder_cup_events(competition_id);

create table if not exists public.tournament_ryder_cup_teams (
  id uuid primary key default gen_random_uuid(),
  ryder_cup_event_id uuid not null references public.tournament_ryder_cup_events(id) on delete cascade,
  name text not null,
  color text null,
  display_order integer not null default 0,
  captain_tournament_player_id uuid null references public.tournament_players(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  constraint tournament_ryder_cup_teams_event_name_unique
    unique (ryder_cup_event_id, name),
  constraint tournament_ryder_cup_teams_event_display_order_unique
    unique (ryder_cup_event_id, display_order)
);

create index if not exists tournament_ryder_cup_teams_event_idx
  on public.tournament_ryder_cup_teams(ryder_cup_event_id);

create table if not exists public.tournament_ryder_cup_team_members (
  id uuid primary key default gen_random_uuid(),
  ryder_cup_team_id uuid not null references public.tournament_ryder_cup_teams(id) on delete cascade,
  tournament_player_id uuid not null references public.tournament_players(id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  constraint tournament_ryder_cup_team_members_team_player_unique
    unique (ryder_cup_team_id, tournament_player_id)
);

create index if not exists tournament_ryder_cup_team_members_team_idx
  on public.tournament_ryder_cup_team_members(ryder_cup_team_id);

create index if not exists tournament_ryder_cup_team_members_player_idx
  on public.tournament_ryder_cup_team_members(tournament_player_id);

create table if not exists public.tournament_ryder_cup_sessions (
  id uuid primary key default gen_random_uuid(),
  ryder_cup_event_id uuid not null references public.tournament_ryder_cup_events(id) on delete cascade,
  name text not null,
  session_date date null,
  display_order integer not null default 0,
  default_match_format text not null default 'singles',
  status text not null default 'draft',
  created_at timestamptz not null default timezone('utc', now()),
  constraint tournament_ryder_cup_sessions_format_check
    check (default_match_format in ('singles', 'four_ball', 'foursomes', 'scramble')),
  constraint tournament_ryder_cup_sessions_status_check
    check (status in ('draft', 'active', 'completed', 'archived'))
);

create index if not exists tournament_ryder_cup_sessions_event_idx
  on public.tournament_ryder_cup_sessions(ryder_cup_event_id);

create index if not exists tournament_ryder_cup_sessions_order_idx
  on public.tournament_ryder_cup_sessions(ryder_cup_event_id, display_order);

create table if not exists public.tournament_ryder_cup_matches (
  id uuid primary key default gen_random_uuid(),
  ryder_cup_event_id uuid not null references public.tournament_ryder_cup_events(id) on delete cascade,
  session_id uuid not null references public.tournament_ryder_cup_sessions(id) on delete cascade,
  tournament_match_id uuid null references public.tournament_matches(id) on delete set null,
  match_format text not null,
  team_a_id uuid not null references public.tournament_ryder_cup_teams(id),
  team_b_id uuid not null references public.tournament_ryder_cup_teams(id),
  team_a_points numeric not null default 0,
  team_b_points numeric not null default 0,
  status text not null default 'scheduled',
  display_order integer not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  constraint tournament_ryder_cup_matches_format_check
    check (match_format in ('singles', 'four_ball', 'foursomes', 'scramble')),
  constraint tournament_ryder_cup_matches_status_check
    check (status in ('scheduled', 'active', 'completed', 'cancelled')),
  constraint tournament_ryder_cup_matches_nonnegative_points_check
    check (team_a_points >= 0 and team_b_points >= 0),
  constraint tournament_ryder_cup_matches_completed_points_check
    check (
      status <> 'completed'
      or (
        (team_a_points = 1 and team_b_points = 0)
        or (team_a_points = 0.5 and team_b_points = 0.5)
        or (team_a_points = 0 and team_b_points = 1)
      )
    ),
  constraint tournament_ryder_cup_matches_distinct_teams_check
    check (team_a_id <> team_b_id)
);

create index if not exists tournament_ryder_cup_matches_event_idx
  on public.tournament_ryder_cup_matches(ryder_cup_event_id);

create index if not exists tournament_ryder_cup_matches_session_idx
  on public.tournament_ryder_cup_matches(session_id);

create index if not exists tournament_ryder_cup_matches_tournament_match_idx
  on public.tournament_ryder_cup_matches(tournament_match_id);

create or replace function public.prevent_duplicate_ryder_cup_team_member()
returns trigger
language plpgsql
as $$
declare
  v_event_id uuid;
begin
  select team.ryder_cup_event_id
    into v_event_id
  from public.tournament_ryder_cup_teams team
  where team.id = new.ryder_cup_team_id;

  if exists (
    select 1
    from public.tournament_ryder_cup_team_members member
    join public.tournament_ryder_cup_teams team
      on team.id = member.ryder_cup_team_id
    where team.ryder_cup_event_id = v_event_id
      and member.tournament_player_id = new.tournament_player_id
      and member.id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid)
  ) then
    raise exception 'Tournament player is already assigned to a Ryder Cup team for this event.';
  end if;

  return new;
end;
$$;

drop trigger if exists tournament_ryder_cup_team_members_no_duplicate_event_member
  on public.tournament_ryder_cup_team_members;

create trigger tournament_ryder_cup_team_members_no_duplicate_event_member
before insert or update on public.tournament_ryder_cup_team_members
for each row
execute function public.prevent_duplicate_ryder_cup_team_member();

alter table public.tournament_ryder_cup_events enable row level security;
alter table public.tournament_ryder_cup_teams enable row level security;
alter table public.tournament_ryder_cup_team_members enable row level security;
alter table public.tournament_ryder_cup_sessions enable row level security;
alter table public.tournament_ryder_cup_matches enable row level security;

create or replace function public.is_ryder_cup_tournament_participant(p_tournament_id uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.tournament_players tp
    where tp.tournament_id = p_tournament_id
      and tp.user_id = auth.uid()
      and tp.is_active = true
  );
$$;

create or replace function public.can_manage_ryder_cup_tournament(p_tournament_id uuid)
returns boolean
language plpgsql
stable
as $$
declare
  v_uid uuid := auth.uid();
  v_allowed boolean := false;
begin
  if v_uid is null then
    return false;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'tournaments'
      and column_name = 'owner_user_id'
  ) then
    execute 'select exists (select 1 from public.tournaments where id = $1 and owner_user_id = $2)'
      into v_allowed
      using p_tournament_id, v_uid;
    if v_allowed then
      return true;
    end if;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'tournaments'
      and column_name = 'created_by_user_id'
  ) then
    execute 'select exists (select 1 from public.tournaments where id = $1 and created_by_user_id = $2)'
      into v_allowed
      using p_tournament_id, v_uid;
    if v_allowed then
      return true;
    end if;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'tournament_players'
      and column_name = 'role'
  ) then
    execute '
      select exists (
        select 1
        from public.tournament_players
        where tournament_id = $1
          and user_id = $2
          and is_active = true
          and lower(role::text) in (''owner'', ''admin'', ''captain'', ''manager'', ''tournament_admin'')
      )'
      into v_allowed
      using p_tournament_id, v_uid;
    if v_allowed then
      return true;
    end if;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'tournament_players'
      and column_name = 'is_admin'
  ) then
    execute '
      select exists (
        select 1
        from public.tournament_players
        where tournament_id = $1
          and user_id = $2
          and is_active = true
          and is_admin = true
      )'
      into v_allowed
      using p_tournament_id, v_uid;
    if v_allowed then
      return true;
    end if;
  end if;

  return false;
end;
$$;

drop policy if exists "ryder_cup_events_participant_select" on public.tournament_ryder_cup_events;
create policy "ryder_cup_events_participant_select"
on public.tournament_ryder_cup_events
for select
using (public.is_ryder_cup_tournament_participant(tournament_ryder_cup_events.tournament_id));

drop policy if exists "ryder_cup_events_manager_all" on public.tournament_ryder_cup_events;
create policy "ryder_cup_events_manager_all"
on public.tournament_ryder_cup_events
for all
using (public.can_manage_ryder_cup_tournament(tournament_ryder_cup_events.tournament_id))
with check (public.can_manage_ryder_cup_tournament(tournament_ryder_cup_events.tournament_id));

drop policy if exists "ryder_cup_teams_participant_select" on public.tournament_ryder_cup_teams;
create policy "ryder_cup_teams_participant_select"
on public.tournament_ryder_cup_teams
for select
using (
  exists (
    select 1
    from public.tournament_ryder_cup_events event
    where event.id = tournament_ryder_cup_teams.ryder_cup_event_id
      and public.is_ryder_cup_tournament_participant(event.tournament_id)
  )
);

drop policy if exists "ryder_cup_teams_manager_all" on public.tournament_ryder_cup_teams;
create policy "ryder_cup_teams_manager_all"
on public.tournament_ryder_cup_teams
for all
using (
  exists (
    select 1
    from public.tournament_ryder_cup_events event
    where event.id = tournament_ryder_cup_teams.ryder_cup_event_id
      and public.can_manage_ryder_cup_tournament(event.tournament_id)
  )
)
with check (
  exists (
    select 1
    from public.tournament_ryder_cup_events event
    where event.id = tournament_ryder_cup_teams.ryder_cup_event_id
      and public.can_manage_ryder_cup_tournament(event.tournament_id)
  )
);

drop policy if exists "ryder_cup_team_members_participant_select" on public.tournament_ryder_cup_team_members;
create policy "ryder_cup_team_members_participant_select"
on public.tournament_ryder_cup_team_members
for select
using (
  exists (
    select 1
    from public.tournament_ryder_cup_teams team
    join public.tournament_ryder_cup_events event
      on event.id = team.ryder_cup_event_id
    where team.id = tournament_ryder_cup_team_members.ryder_cup_team_id
      and public.is_ryder_cup_tournament_participant(event.tournament_id)
  )
);

drop policy if exists "ryder_cup_team_members_manager_all" on public.tournament_ryder_cup_team_members;
create policy "ryder_cup_team_members_manager_all"
on public.tournament_ryder_cup_team_members
for all
using (
  exists (
    select 1
    from public.tournament_ryder_cup_teams team
    join public.tournament_ryder_cup_events event
      on event.id = team.ryder_cup_event_id
    where team.id = tournament_ryder_cup_team_members.ryder_cup_team_id
      and public.can_manage_ryder_cup_tournament(event.tournament_id)
  )
)
with check (
  exists (
    select 1
    from public.tournament_ryder_cup_teams team
    join public.tournament_ryder_cup_events event
      on event.id = team.ryder_cup_event_id
    where team.id = tournament_ryder_cup_team_members.ryder_cup_team_id
      and public.can_manage_ryder_cup_tournament(event.tournament_id)
  )
);

drop policy if exists "ryder_cup_sessions_participant_select" on public.tournament_ryder_cup_sessions;
create policy "ryder_cup_sessions_participant_select"
on public.tournament_ryder_cup_sessions
for select
using (
  exists (
    select 1
    from public.tournament_ryder_cup_events event
    where event.id = tournament_ryder_cup_sessions.ryder_cup_event_id
      and public.is_ryder_cup_tournament_participant(event.tournament_id)
  )
);

drop policy if exists "ryder_cup_sessions_manager_all" on public.tournament_ryder_cup_sessions;
create policy "ryder_cup_sessions_manager_all"
on public.tournament_ryder_cup_sessions
for all
using (
  exists (
    select 1
    from public.tournament_ryder_cup_events event
    where event.id = tournament_ryder_cup_sessions.ryder_cup_event_id
      and public.can_manage_ryder_cup_tournament(event.tournament_id)
  )
)
with check (
  exists (
    select 1
    from public.tournament_ryder_cup_events event
    where event.id = tournament_ryder_cup_sessions.ryder_cup_event_id
      and public.can_manage_ryder_cup_tournament(event.tournament_id)
  )
);

drop policy if exists "ryder_cup_matches_participant_select" on public.tournament_ryder_cup_matches;
create policy "ryder_cup_matches_participant_select"
on public.tournament_ryder_cup_matches
for select
using (
  exists (
    select 1
    from public.tournament_ryder_cup_events event
    where event.id = tournament_ryder_cup_matches.ryder_cup_event_id
      and public.is_ryder_cup_tournament_participant(event.tournament_id)
  )
);

drop policy if exists "ryder_cup_matches_manager_all" on public.tournament_ryder_cup_matches;
create policy "ryder_cup_matches_manager_all"
on public.tournament_ryder_cup_matches
for all
using (
  exists (
    select 1
    from public.tournament_ryder_cup_events event
    where event.id = tournament_ryder_cup_matches.ryder_cup_event_id
      and public.can_manage_ryder_cup_tournament(event.tournament_id)
  )
)
with check (
  exists (
    select 1
    from public.tournament_ryder_cup_events event
    where event.id = tournament_ryder_cup_matches.ryder_cup_event_id
      and public.can_manage_ryder_cup_tournament(event.tournament_id)
  )
);

notify pgrst, 'reload schema';

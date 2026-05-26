-- Read-only schema discovery for existing regular-round game infrastructure.
-- Run each query block in Supabase SQL Editor and copy the result sets back.

-- ============================================================
-- 1. Target object list
-- ============================================================
select *
from (
  values
    ('public', 'round_games', 'table'),
    ('public', 'round_game_bbb_holes', 'table'),
    ('public', 'round_game_bbb_hole_scores', 'table'),
    ('public', 'round_game_skins_holes', 'table'),
    ('public', 'round_game_skins_hole_scores', 'table'),
    ('public', 'v_round_game_bbb_live_standings', 'view'),
    ('public', 'v_round_game_bbb_hole_history', 'view'),
    ('public', 'v_round_game_skins_live_standings', 'view'),
    ('public', 'v_round_game_skins_hole_history', 'view')
) as target_objects(schema_name, object_name, object_type)
order by object_type, object_name;

-- ============================================================
-- 2. Table and view columns, types, defaults, nullability
-- ============================================================
select
  c.table_schema,
  c.table_name,
  c.ordinal_position,
  c.column_name,
  c.data_type,
  c.udt_name,
  c.is_nullable,
  c.column_default
from information_schema.columns c
where (c.table_schema, c.table_name) in (
  ('public', 'round_games'),
  ('public', 'round_game_bbb_holes'),
  ('public', 'round_game_bbb_hole_scores'),
  ('public', 'round_game_skins_holes'),
  ('public', 'round_game_skins_hole_scores'),
  ('public', 'v_round_game_bbb_live_standings'),
  ('public', 'v_round_game_bbb_hole_history'),
  ('public', 'v_round_game_skins_live_standings'),
  ('public', 'v_round_game_skins_hole_history')
)
order by c.table_schema, c.table_name, c.ordinal_position;

-- ============================================================
-- 3. Primary keys, unique constraints, foreign keys
-- ============================================================
select
  tc.table_schema,
  tc.table_name,
  tc.constraint_name,
  tc.constraint_type,
  kcu.column_name,
  ccu.table_schema as foreign_table_schema,
  ccu.table_name as foreign_table_name,
  ccu.column_name as foreign_column_name
from information_schema.table_constraints tc
left join information_schema.key_column_usage kcu
  on tc.constraint_schema = kcu.constraint_schema
 and tc.constraint_name = kcu.constraint_name
 and tc.table_schema = kcu.table_schema
 and tc.table_name = kcu.table_name
left join information_schema.constraint_column_usage ccu
  on tc.constraint_schema = ccu.constraint_schema
 and tc.constraint_name = ccu.constraint_name
where (tc.table_schema, tc.table_name) in (
  ('public', 'round_games'),
  ('public', 'round_game_bbb_holes'),
  ('public', 'round_game_bbb_hole_scores'),
  ('public', 'round_game_skins_holes'),
  ('public', 'round_game_skins_hole_scores')
)
and tc.constraint_type in ('PRIMARY KEY', 'UNIQUE', 'FOREIGN KEY')
order by tc.table_name, tc.constraint_type, tc.constraint_name, kcu.ordinal_position;

-- ============================================================
-- 4. Check constraints, including game_type constraints
-- ============================================================
select
  tc.table_schema,
  tc.table_name,
  tc.constraint_name,
  cc.check_clause
from information_schema.table_constraints tc
join information_schema.check_constraints cc
  on tc.constraint_schema = cc.constraint_schema
 and tc.constraint_name = cc.constraint_name
where (tc.table_schema, tc.table_name) in (
  ('public', 'round_games'),
  ('public', 'round_game_bbb_holes'),
  ('public', 'round_game_bbb_hole_scores'),
  ('public', 'round_game_skins_holes'),
  ('public', 'round_game_skins_hole_scores')
)
order by tc.table_name, tc.constraint_name;

select
  n.nspname as schema_name,
  rel.relname as table_name,
  con.conname as constraint_name,
  pg_get_constraintdef(con.oid, true) as constraint_definition
from pg_constraint con
join pg_class rel
  on rel.oid = con.conrelid
join pg_namespace n
  on n.oid = rel.relnamespace
where n.nspname = 'public'
  and rel.relname = 'round_games'
  and pg_get_constraintdef(con.oid, true) ilike '%game_type%'
order by con.conname;

-- ============================================================
-- 5. Indexes
-- ============================================================
select
  schemaname,
  tablename,
  indexname,
  indexdef
from pg_indexes
where schemaname = 'public'
  and tablename in (
    'round_games',
    'round_game_bbb_holes',
    'round_game_bbb_hole_scores',
    'round_game_skins_holes',
    'round_game_skins_hole_scores'
  )
order by tablename, indexname;

-- ============================================================
-- 6. Triggers
-- ============================================================
select
  event_object_schema,
  event_object_table,
  trigger_name,
  action_timing,
  event_manipulation,
  action_orientation,
  action_statement
from information_schema.triggers
where event_object_schema = 'public'
  and event_object_table in (
    'round_games',
    'round_game_bbb_holes',
    'round_game_bbb_hole_scores',
    'round_game_skins_holes',
    'round_game_skins_hole_scores'
  )
order by event_object_table, trigger_name, event_manipulation;

-- ============================================================
-- 7. RLS enabled / forced status
-- ============================================================
select
  n.nspname as schema_name,
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as rls_forced
from pg_class c
join pg_namespace n
  on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in (
    'round_games',
    'round_game_bbb_holes',
    'round_game_bbb_hole_scores',
    'round_game_skins_holes',
    'round_game_skins_hole_scores'
  )
order by c.relname;

-- ============================================================
-- 8. RLS policy definitions
-- ============================================================
select
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
from pg_policies
where schemaname = 'public'
  and tablename in (
    'round_games',
    'round_game_bbb_holes',
    'round_game_bbb_hole_scores',
    'round_game_skins_holes',
    'round_game_skins_hole_scores'
  )
order by tablename, policyname;

-- ============================================================
-- 9. View definitions
-- ============================================================
select
  v.table_schema,
  v.table_name,
  v.view_definition
from information_schema.views v
where (v.table_schema, v.table_name) in (
  ('public', 'v_round_game_bbb_live_standings'),
  ('public', 'v_round_game_bbb_hole_history'),
  ('public', 'v_round_game_skins_live_standings'),
  ('public', 'v_round_game_skins_hole_history')
)
order by v.table_name;

-- ============================================================
-- 10. Function / RPC discovery by name
-- ============================================================
select
  n.nspname as schema_name,
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as identity_arguments,
  pg_get_function_result(p.oid) as return_type,
  l.lanname as language_name,
  pg_get_functiondef(p.oid) as function_definition
from pg_proc p
join pg_namespace n
  on n.oid = p.pronamespace
join pg_language l
  on l.oid = p.prolang
where n.nspname = 'public'
  and (
    p.proname ilike '%bbb%'
    or p.proname ilike '%bingo%'
    or p.proname ilike '%skins%'
    or p.proname ilike '%round_game%'
    or p.proname ilike '%group_round%'
    or p.proname ilike '%history%'
  )
order by p.proname, pg_get_function_identity_arguments(p.oid);

-- ============================================================
-- 11. Grants / privileges
-- ============================================================
select
  table_schema,
  table_name,
  grantee,
  privilege_type,
  is_grantable
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in (
    'round_games',
    'round_game_bbb_holes',
    'round_game_bbb_hole_scores',
    'round_game_skins_holes',
    'round_game_skins_hole_scores'
  )
order by table_name, grantee, privilege_type;

select
  routine_schema,
  routine_name,
  grantee,
  privilege_type,
  is_grantable
from information_schema.role_routine_grants
where routine_schema = 'public'
  and (
    routine_name ilike '%bbb%'
    or routine_name ilike '%bingo%'
    or routine_name ilike '%skins%'
    or routine_name ilike '%round_game%'
    or routine_name ilike '%group_round%'
    or routine_name ilike '%history%'
  )
order by routine_name, grantee, privilege_type;

-- ============================================================
-- 12. Dependency search for target views/functions
-- ============================================================
select
  dependent_ns.nspname as dependent_schema,
  dependent_view.relname as dependent_view,
  source_ns.nspname as source_schema,
  source_table.relname as source_object
from pg_depend dep
join pg_rewrite rw
  on rw.oid = dep.objid
join pg_class dependent_view
  on dependent_view.oid = rw.ev_class
join pg_class source_table
  on source_table.oid = dep.refobjid
join pg_namespace dependent_ns
  on dependent_ns.oid = dependent_view.relnamespace
join pg_namespace source_ns
  on source_ns.oid = source_table.relnamespace
where dependent_ns.nspname = 'public'
  and dependent_view.relname in (
    'v_round_game_bbb_live_standings',
    'v_round_game_bbb_hole_history',
    'v_round_game_skins_live_standings',
    'v_round_game_skins_hole_history'
  )
order by dependent_view.relname, source_table.relname;

-- ============================================================
-- 13. Constraint and enum-like text search for game labels
-- ============================================================
select
  n.nspname as schema_name,
  c.relname as table_name,
  con.conname as constraint_name,
  pg_get_constraintdef(con.oid, true) as constraint_definition
from pg_constraint con
join pg_class c
  on c.oid = con.conrelid
join pg_namespace n
  on n.oid = c.relnamespace
where n.nspname = 'public'
  and (
    pg_get_constraintdef(con.oid, true) ilike '%bingo_bango_bongo%'
    or pg_get_constraintdef(con.oid, true) ilike '%skins%'
  )
order by c.relname, con.conname;

select
  n.nspname as schema_name,
  t.typname as type_name,
  e.enumlabel as enum_value
from pg_type t
join pg_enum e
  on e.enumtypid = t.oid
join pg_namespace n
  on n.oid = t.typnamespace
where n.nspname = 'public'
  and (
    e.enumlabel ilike '%bingo%'
    or e.enumlabel ilike '%skins%'
  )
order by t.typname, e.enumsortorder;

-- ============================================================
-- 14. Helpful round_games snapshot
-- ============================================================
select
  game_type,
  count(*) as row_count
from public.round_games
group by game_type
order by game_type;

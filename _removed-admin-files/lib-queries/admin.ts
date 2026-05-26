import { createClient } from '@/lib/supabase/server'

export async function getOwnedTournaments(ownerUserId: string) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('tournaments')
    .select(`
      id,
      owner_user_id,
      name,
      description,
      invite_code,
      start_date,
      end_date,
      status,
      confirmation_rule,
      created_at,
      event_category,
      format_type,
      visibility,
      max_active_players,
      is_recurring,
      recurrence_rule,
      invite_code_active,
      allow_direct_add,
      birdie_pot_enabled,
      skins_enabled,
      carry_balances_enabled,
      default_payout_mode
    `)
    .eq('owner_user_id', ownerUserId)
    .order('start_date', { ascending: false })

  if (error) throw error
  return data ?? []
}

export async function getOwnedTournamentById(ownerUserId: string, tournamentId: string) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('tournaments')
    .select(`
      id,
      owner_user_id,
      name,
      description,
      invite_code,
      start_date,
      end_date,
      status,
      confirmation_rule,
      created_at,
      event_category,
      format_type,
      visibility,
      max_active_players,
      is_recurring,
      recurrence_rule,
      invite_code_active,
      allow_direct_add,
      birdie_pot_enabled,
      skins_enabled,
      carry_balances_enabled,
      default_payout_mode
    `)
    .eq('owner_user_id', ownerUserId)
    .eq('id', tournamentId)
    .single()

  if (error) throw error
  return data
}

export async function getDashboardCounts(ownerUserId: string) {
  const supabase = await createClient()

  const { data: tournaments, error: tournamentsError } = await supabase
    .from('tournaments')
    .select('id, status')
    .eq('owner_user_id', ownerUserId)

  if (tournamentsError) throw tournamentsError

  const tournamentIds = (tournaments ?? []).map((t) => t.id)
  const activeTournaments = (tournaments ?? []).filter((t) => t.status === 'active').length

  if (tournamentIds.length === 0) {
    return {
      activeTournaments,
      pendingRounds: 0,
      disputedRounds: 0,
    }
  }

  const [pendingRes, disputesRes] = await Promise.all([
    supabase
      .from('rounds')
      .select('id', { count: 'exact', head: true })
      .in('tournament_id', tournamentIds)
      .eq('status', 'pending_confirmation'),
    supabase
      .from('rounds')
      .select('id', { count: 'exact', head: true })
      .in('tournament_id', tournamentIds)
      .eq('status', 'disputed'),
  ])

  if (pendingRes.error) throw pendingRes.error
  if (disputesRes.error) throw disputesRes.error

  return {
    activeTournaments,
    pendingRounds: pendingRes.count ?? 0,
    disputedRounds: disputesRes.count ?? 0,
  }
}

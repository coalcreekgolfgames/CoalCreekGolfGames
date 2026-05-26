import { supabase } from '@/lib/supabase';
import type { GroupParticipant } from '@/types/round';

export type RecurringRoundGroup = {
  id: string;
  ownerUserId: string;
  name: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type RecurringRoundGroupMember = {
  id: string;
  recurringGroupId: string;
  seatOrder: number;
  userId: string | null;
  guestProfileId: string | null;
  displayName: string;
  firstName: string;
  lastName: string;
};

type SaveRecurringRoundGroupParams = {
  ownerUserId: string;
  name: string;
  participants: GroupParticipant[];
};

function normalizeNameParts(displayName: string) {
  const clean = displayName.trim() || 'Player';
  const [firstName, ...rest] = clean.split(/\s+/);
  return {
    firstName: firstName || 'Player',
    lastName: rest.join(' '),
  };
}

export async function listRecurringRoundGroups(ownerUserId: string): Promise<RecurringRoundGroup[]> {
  const { data, error } = await supabase
    .from('recurring_round_groups')
    .select('id, owner_user_id, name, is_active, created_at, updated_at')
    .eq('owner_user_id', ownerUserId)
    .eq('is_active', true)
    .order('updated_at', { ascending: false })
    .order('created_at', { ascending: false });

  if (error) throw error;

  return (data ?? []).map((row: any) => ({
    id: row.id,
    ownerUserId: row.owner_user_id,
    name: row.name,
    isActive: row.is_active === true,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export async function getRecurringRoundGroupMembers(
  ownerUserId: string,
  recurringGroupId: string,
): Promise<RecurringRoundGroupMember[]> {
  const { data: group, error: groupError } = await supabase
    .from('recurring_round_groups')
    .select('id')
    .eq('id', recurringGroupId)
    .eq('owner_user_id', ownerUserId)
    .eq('is_active', true)
    .maybeSingle();

  if (groupError) throw groupError;
  if (!group) throw new Error('Saved group not found.');

  const { data, error } = await supabase
    .from('recurring_round_group_members')
    .select('id, recurring_group_id, seat_order, user_id, guest_profile_id, display_name, created_at')
    .eq('recurring_group_id', recurringGroupId)
    .order('seat_order', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) throw error;

  const rows = data ?? [];
  const userIds = rows.map((row: any) => row.user_id).filter(Boolean);
  const guestProfileIds = rows.map((row: any) => row.guest_profile_id).filter(Boolean);

  const [profilesRes, guestsRes] = await Promise.all([
    userIds.length
      ? supabase.from('profiles').select('id, first_name, last_name').in('id', userIds)
      : Promise.resolve({ data: [], error: null }),
    guestProfileIds.length
      ? supabase.from('user_guest_profiles').select('id, first_name, last_name').in('id', guestProfileIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (profilesRes.error) throw profilesRes.error;
  if (guestsRes.error) throw guestsRes.error;

  const profilesById = new Map((profilesRes.data ?? []).map((profile: any) => [profile.id, profile]));
  const guestsById = new Map((guestsRes.data ?? []).map((guest: any) => [guest.id, guest]));

  return rows.map((row: any) => {
    const profile = row.user_id ? profilesById.get(row.user_id) : null;
    const guest = row.guest_profile_id ? guestsById.get(row.guest_profile_id) : null;
    const displayName = [
      profile?.first_name ?? guest?.first_name,
      profile?.last_name ?? guest?.last_name,
    ].filter(Boolean).join(' ').trim() || String(row.display_name ?? '').trim() || 'Player';
    const fallbackParts = normalizeNameParts(displayName);

    return {
      id: row.id,
      recurringGroupId: row.recurring_group_id,
      seatOrder: Number(row.seat_order),
      userId: row.user_id ?? null,
      guestProfileId: row.guest_profile_id ?? null,
      displayName,
      firstName: profile?.first_name ?? guest?.first_name ?? fallbackParts.firstName,
      lastName: profile?.last_name ?? guest?.last_name ?? fallbackParts.lastName,
    };
  });
}

export async function saveRecurringRoundGroup({
  ownerUserId,
  name,
  participants,
}: SaveRecurringRoundGroupParams): Promise<string> {
  const cleanName = name.trim();
  if (!cleanName) throw new Error('Saved group name is required.');

  const { data: group, error: groupError } = await supabase
    .from('recurring_round_groups')
    .insert({
      owner_user_id: ownerUserId,
      name: cleanName,
    })
    .select('id')
    .single();

  if (groupError) throw groupError;

  const memberRows = participants.map((participant, index) => ({
    recurring_group_id: group.id,
    seat_order: index + 1,
    user_id: participant.type === 'app_user' ? participant.id : null,
    guest_profile_id: participant.type === 'guest' ? participant.id : null,
    display_name: participant.displayName,
  }));

  const { error: membersError } = await supabase
    .from('recurring_round_group_members')
    .insert(memberRows);

  if (membersError) throw membersError;
  return group.id;
}

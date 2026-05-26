import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/lib/supabase';

export type GuestClaimCandidate = {
  guest_profile_id: string;
  owner_user_id: string;
  owner_first_name: string | null;
  owner_last_name: string | null;
  guest_first_name: string;
  guest_last_name: string;
  display_name: string;
  rounds_count: number;
  last_round_date: string | null;
};

function dismissedKey(userId: string) {
  return `guest-claim-dismissed:${userId}`;
}

export async function fetchGuestClaimCandidates(firstName: string, lastName: string) {
  const { data, error } = await supabase.rpc('get_guest_claim_candidates', {
    p_first_name: firstName,
    p_last_name: lastName,
  });

  if (error) throw error;
  return (data ?? []) as GuestClaimCandidate[];
}

export async function claimMyGuestProfile(guestProfileId: string, associatePastRounds: boolean) {
  const { error } = await supabase.rpc('claim_my_guest_profile', {
    p_guest_profile_id: guestProfileId,
    p_associate_past_rounds: associatePastRounds,
  });

  if (error) throw error;
}

export async function loadDismissedGuestClaimIds(userId: string) {
  const raw = await AsyncStorage.getItem(dismissedKey(userId));
  if (!raw) return [] as string[];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : [];
  } catch {
    return [];
  }
}

export async function dismissGuestClaimId(userId: string, guestProfileId: string) {
  const current = await loadDismissedGuestClaimIds(userId);
  if (current.includes(guestProfileId)) return current;
  const next = [...current, guestProfileId];
  await AsyncStorage.setItem(dismissedKey(userId), JSON.stringify(next));
  return next;
}

export async function clearDismissedGuestClaimId(userId: string, guestProfileId: string) {
  const current = await loadDismissedGuestClaimIds(userId);
  const next = current.filter((id) => id !== guestProfileId);
  await AsyncStorage.setItem(dismissedKey(userId), JSON.stringify(next));
  return next;
}

import React, { useEffect, useMemo, useState } from 'react';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { BrandWatermarkBackground } from '@/components/BrandWatermarkBackground';
import { CoalCreekHeader } from '@/components/CoalCreekHeader';
import { PlayerBottomNav } from '@/components/navigation/PlayerBottomNav';
import { PlayerCard, PlayerCardGrid } from '@/components/round/PlayerCardGrid';
import { RoundHeroActionCard } from '@/components/round/RoundHeroActionCard';
import { AppButton } from '@/components/ui/AppButton';
import { AppInput } from '@/components/ui/AppInput';
import { SectionCard } from '@/components/ui/SectionCard';
import {
  holes,
  ratingInfoFor,
  teeOptions,
  totalYardageForTee,
  type RatingType,
  type TeeOption,
} from '@/constants/course';
import { deleteCurrentRound, describeCurrentRound } from '@/lib/currentRound';
import { formatCurrencyFromCents, parseCurrencyInputToCents } from '@/lib/currency';
import { loadDraftRound, loadRecentGuests, saveDraftRound } from '@/lib/localRound';
import {
  getRecurringRoundGroupMembers,
  listRecurringRoundGroups,
  saveRecurringRoundGroup,
  type RecurringRoundGroup,
} from '@/lib/recurringRoundGroups';
import { startRegularGroupRound } from '@/lib/groupRoundCompanions';
import { getRoundWelcomeFirstName } from '@/lib/roundWelcome';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/providers/AuthProvider';
import type { GroupGameMode, GroupParticipant, LocalRoundDraft, WolfScoringMode } from '@/types/round';

type EditableSeat = 2 | 3 | 4;
type SeatEditorMode = 'existing' | 'new';
type GroupSetupChoice = 'choose' | 'saved' | 'create';
type SeatDraft = {
  seat: EditableSeat;
  mode: SeatEditorMode;
  firstName: string;
  lastName: string;
};
type SeatIdentity = {
  userId?: string | null;
  guestProfileId?: string | null;
  displayName?: string | null;
};

type SearchPlayerResultSource =
  | 'profile'
  | 'tournament_player'
  | 'round_participant'
  | 'round_participant_guest'
  | 'guest_profile'
  | 'local';

type SearchPlayerResult = {
  firstName: string;
  lastName: string;
  displayName: string;
  source: SearchPlayerResultSource;
  sourcePriority?: number | null;
  isGuest?: boolean | null;
  userId?: string | null;
  guestProfileId?: string | null;
};

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function makeGuestId(slot: number) {
  return `guest-${slot}-${Date.now()}`;
}

function getBackendGroupGameType(groupGameMode: GroupGameMode) {
  if (groupGameMode === 'bingo_bango_bongo' || groupGameMode === 'skins' || groupGameMode === 'nassau' || groupGameMode === 'wolf') return groupGameMode;
  return 'standard';
}

function getBackendGroupGameName(groupName: string, groupGameMode: GroupGameMode) {
  if (groupGameMode === 'bingo_bango_bongo') return `${groupName} BBB`;
  if (groupGameMode === 'skins') return `${groupName} Skins`;
  if (groupGameMode === 'nassau') return `${groupName} Nassau`;
  if (groupGameMode === 'wolf') return `${groupName} Wolf`;
  return groupName;
}

function isDuplicateRecurringGroupNameError(error: any) {
  const message = String(error?.message ?? '');
  return error?.code === '23505' || message.includes('recurring_round_groups_owner_active_name_uidx');
}

function showDuplicateRecurringGroupNameAlert() {
  Alert.alert('Group name already exists', 'That group name already exists. Please choose a different name.');
}

function normalizeLocalFallbackGuests(guests: GroupParticipant[]) {
  const deduped = new Map<string, SearchPlayerResult>();

  guests.forEach((guest) => {
    const firstName = guest.firstName.trim();
    const lastName = guest.lastName.trim();
    if (!firstName || !lastName) return;

    const key = `${firstName.toLowerCase()}::${lastName.toLowerCase()}`;
    if (!deduped.has(key)) {
      deduped.set(key, {
        firstName,
        lastName,
        displayName: `${firstName} ${lastName}`,
        source: 'local',
      });
    }
  });

  return Array.from(deduped.values()).sort((a, b) => a.displayName.localeCompare(b.displayName));
}

function sameStringSet(a: string[], b: string[]) {
  if (a.length !== b.length) return false;
  const aSet = new Set(a);
  return b.every((id) => aSet.has(id));
}

function sanitizeWolfOrder(participantIds: string[], currentOrder: string[]) {
  const validIds = Array.from(new Set(participantIds.filter((id) => typeof id === 'string' && id.trim().length > 0)));
  const seen = new Set<string>();
  const nextOrder: string[] = [];

  currentOrder.forEach((participantId) => {
    if (!validIds.includes(participantId) || seen.has(participantId)) return;
    seen.add(participantId);
    nextOrder.push(participantId);
  });

  validIds.forEach((participantId) => {
    if (seen.has(participantId)) return;
    seen.add(participantId);
    nextOrder.push(participantId);
  });

  return nextOrder;
}

async function ensureGuestProfile(userId: string, firstName: string, lastName: string) {
  const cleanFirst = firstName.trim();
  const cleanLast = lastName.trim();
  if (!cleanFirst || !cleanLast) return null;

  const { data: existing, error: existingError } = await supabase
    .from('user_guest_profiles')
    .select('id, first_name, last_name')
    .eq('owner_user_id', userId)
    .ilike('first_name', cleanFirst)
    .ilike('last_name', cleanLast)
    .maybeSingle();

  if (existingError) throw existingError;
  if (existing?.id) return existing;

  const { data: created, error: createError } = await supabase
    .from('user_guest_profiles')
    .insert({
      owner_user_id: userId,
      first_name: cleanFirst,
      last_name: cleanLast,
    })
    .select('id, first_name, last_name')
    .single();

  if (createError) throw createError;
  return created;
}

function normalizeSearchPlayerRow(row: {
  source_type: SearchPlayerResultSource;
  source_priority?: number | null;
  user_id?: string | null;
  guest_profile_id?: string | null;
  display_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  is_guest?: boolean | null;
}): SearchPlayerResult {
  const firstName = String(row.first_name ?? '').trim();
  const lastName = String(row.last_name ?? '').trim();
  const displayName =
    String(row.display_name ?? '').trim()
    || `${firstName} ${lastName}`.trim()
    || 'Player';

  return {
    firstName: firstName || displayName.split(' ')[0] || 'Player',
    lastName: lastName || displayName.split(' ').slice(1).join(' '),
    displayName,
    source: row.source_type,
    sourcePriority: row.source_priority ?? null,
    isGuest: row.is_guest ?? null,
    userId: row.user_id ?? null,
    guestProfileId: row.guest_profile_id ?? null,
  };
}

function dedupeSearchResults(results: SearchPlayerResult[]) {
  const seen = new Set<string>();
  const deduped: SearchPlayerResult[] = [];

  results.forEach((player) => {
    const key = player.userId
      ? `user:${player.userId}`
      : player.guestProfileId
        ? `guest:${player.guestProfileId}`
        : `name:${player.firstName.toLowerCase()}|${player.lastName.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    deduped.push(player);
  });

  return deduped;
}

export default function StartGroupRoundScreen() {
  const { profile, user } = useAuth();
  const [date, setDate] = useState(todayIsoDate());
  const [tee, setTee] = useState<TeeOption>('Silver');
  const [ratingType, setRatingType] = useState<RatingType>('men');
  const [groupName, setGroupName] = useState('');
  const [scorekeeperSeat, setScorekeeperSeat] = useState<number>(1);
  const [statsEnabled, setStatsEnabled] = useState(true);
  const [groupGameMode, setGroupGameMode] = useState<GroupGameMode>('none');
  const [bbbBuyIn, setBbbBuyIn] = useState('');
  const [skinsBuyIn, setSkinsBuyIn] = useState('');
  const [nassauBuyIn, setNassauBuyIn] = useState('');
  const [wolfBuyIn, setWolfBuyIn] = useState('');
  const [wolfOrderParticipantIds, setWolfOrderParticipantIds] = useState<string[]>([]);
  const [wolfScoringMode, setWolfScoringMode] = useState<WolfScoringMode>('winner_only');
  const [nassauSelectedParticipantIds, setNassauSelectedParticipantIds] = useState<string[]>([]);
  const [groupSetupChoice, setGroupSetupChoice] = useState<GroupSetupChoice>('choose');
  const [savedGroups, setSavedGroups] = useState<RecurringRoundGroup[]>([]);
  const [savedGroupsLoading, setSavedGroupsLoading] = useState(false);
  const [savedGroupsError, setSavedGroupsError] = useState<string | null>(null);
  const [loadingSavedGroupId, setLoadingSavedGroupId] = useState<string | null>(null);
  const [loadedSavedGroupId, setLoadedSavedGroupId] = useState<string | null>(null);
  const [saveAsRecurring, setSaveAsRecurring] = useState(false);
  const [isSavingRound, setIsSavingRound] = useState(false);
  const [guestOneFirst, setGuestOneFirst] = useState('');
  const [guestOneLast, setGuestOneLast] = useState('');
  const [guestTwoFirst, setGuestTwoFirst] = useState('');
  const [guestTwoLast, setGuestTwoLast] = useState('');
  const [guestThreeFirst, setGuestThreeFirst] = useState('');
  const [guestThreeLast, setGuestThreeLast] = useState('');
  const [seatIdentities, setSeatIdentities] = useState<Record<EditableSeat, SeatIdentity | null>>({
    2: null,
    3: null,
    4: null,
  });
  const [localGuestIds] = useState<Record<EditableSeat, string>>(() => ({
    2: makeGuestId(2),
    3: makeGuestId(3),
    4: makeGuestId(4),
  }));
  const [seatDraft, setSeatDraft] = useState<SeatDraft | null>(null);
  const [seatSearch, setSeatSearch] = useState('');
  const [debouncedSeatSearch, setDebouncedSeatSearch] = useState('');
  const [searchResults, setSearchResults] = useState<SearchPlayerResult[]>([]);
  const [searchFailed, setSearchFailed] = useState(false);
  const [isSavingSeat, setIsSavingSeat] = useState(false);

  useEffect(() => {
    const handle = setTimeout(() => {
      setDebouncedSeatSearch(seatSearch.trim());
    }, 180);

    return () => clearTimeout(handle);
  }, [seatSearch]);

  useEffect(() => {
    let active = true;

    const loadSavedGroups = async () => {
      if (!user?.id || groupSetupChoice !== 'saved') return;

      try {
        setSavedGroupsLoading(true);
        setSavedGroupsError(null);
        const groups = await listRecurringRoundGroups(user.id);
        if (active) setSavedGroups(groups);
      } catch (error: any) {
        console.error('saved recurring groups load failed', error);
        if (active) setSavedGroupsError(error?.message ?? 'Saved groups are unavailable.');
      } finally {
        if (active) setSavedGroupsLoading(false);
      }
    };

    void loadSavedGroups();
    return () => {
      active = false;
    };
  }, [groupSetupChoice, user?.id]);

  useEffect(() => {
    let active = true;

    const runSearch = async () => {
      if (!user?.id || !seatDraft || seatDraft.mode !== 'existing') {
        if (active) {
          setSearchResults([]);
          setSearchFailed(false);
        }
        return;
      }

      const query = debouncedSeatSearch.trim();
      if (!query) {
        if (active) {
          setSearchResults([]);
          setSearchFailed(false);
        }
        return;
      }

      try {
        const { data, error } = await supabase.rpc('search_regular_round_players', {
          p_owner_user_id: user.id,
          p_search: query,
          p_limit: 25,
        });

        if (error) throw error;
        if (!active) return;

        const rpcResults = ((data ?? []) as Parameters<typeof normalizeSearchPlayerRow>[0][])
          .map((row) => normalizeSearchPlayerRow(row));
        setSearchResults(dedupeSearchResults(rpcResults));
        setSearchFailed(false);
      } catch (error) {
        console.error('regular round player search failed', error);
        const localGuests = await loadRecentGuests().catch(() => [] as GroupParticipant[]);
        if (!active) return;

        const loweredQuery = query.toLowerCase();
        const fallbackResults = normalizeLocalFallbackGuests(localGuests).filter((player) =>
          player.displayName.toLowerCase().includes(loweredQuery)
          || player.firstName.toLowerCase().includes(loweredQuery)
          || player.lastName.toLowerCase().includes(loweredQuery),
        );

        setSearchResults(fallbackResults);
        setSearchFailed(true);
      }
    };

    void runSearch();
    return () => {
      active = false;
    };
  }, [debouncedSeatSearch, seatDraft, user?.id]);

  const meFirst = profile?.first_name?.trim() || user?.user_metadata?.first_name || 'App';
  const meLast = profile?.last_name?.trim() || user?.user_metadata?.last_name || 'User';
  const welcomeName = getRoundWelcomeFirstName({ profile, user });
  const seatEntries = useMemo(() => ([
    { firstName: guestOneFirst, lastName: guestOneLast, seat: 2 as EditableSeat },
    { firstName: guestTwoFirst, lastName: guestTwoLast, seat: 3 as EditableSeat },
    { firstName: guestThreeFirst, lastName: guestThreeLast, seat: 4 as EditableSeat },
  ]), [guestOneFirst, guestOneLast, guestTwoFirst, guestTwoLast, guestThreeFirst, guestThreeLast]);

  const participants: GroupParticipant[] = useMemo(() => ([
    {
      id: user?.id || 'me',
      type: 'app_user',
      firstName: meFirst,
      lastName: meLast,
      displayName: `${meFirst} ${meLast}`.trim(),
      isScorekeeper: scorekeeperSeat === 1,
    },
    ...seatEntries
      .filter((entry) => entry.firstName.trim() && entry.lastName.trim())
      .map((entry) => {
        const identity = seatIdentities[entry.seat];
        const displayName = `${entry.firstName.trim()} ${entry.lastName.trim()}`.trim();
        return {
          id: identity?.userId ?? identity?.guestProfileId ?? localGuestIds[entry.seat],
          type: identity?.userId ? 'app_user' as const : 'guest' as const,
          firstName: entry.firstName.trim(),
          lastName: entry.lastName.trim(),
          displayName,
          isScorekeeper: scorekeeperSeat === entry.seat,
        };
      }),
  ]), [localGuestIds, meFirst, meLast, scorekeeperSeat, seatEntries, seatIdentities, user?.id]);

  const validParticipantIds = useMemo(
    () => participants.map((participant) => participant.id),
    [participants],
  );
  const nassauAvailablePlayers = useMemo(
    () => participants.map((participant, index) => ({
      label: participant.displayName,
      participantId: participant.id,
      userId: participant.type === 'app_user' ? participant.id : null,
      guestId: participant.type === 'guest' ? participant.id : null,
      seatOrder: index + 1,
    })),
    [participants],
  );
  const wolfParticipantIds = useMemo(
    () => participants.map((participant) => participant.id),
    [participants],
  );
  const wolfOrderParticipants = useMemo(
    () => wolfOrderParticipantIds
      .map((participantId) => participants.find((participant) => participant.id === participantId) ?? null)
      .filter((participant): participant is GroupParticipant => !!participant),
    [participants, wolfOrderParticipantIds],
  );
  const gameChoices = useMemo(() => ([
    {
      key: 'none' as const,
      title: 'Standard',
      subtitle: 'No side game',
      meta: 'Regular group scoring only',
      disabled: false,
    },
    {
      key: 'bingo_bango_bongo' as const,
      title: 'BBB',
      subtitle: 'Bingo Bango Bongo',
      meta: 'Best with 3 or 4 players',
      disabled: false,
    },
    {
      key: 'skins' as const,
      title: 'Skins',
      subtitle: 'Lowest unique score wins',
      meta: 'Gross score side game',
      disabled: false,
    },
    {
      key: 'nassau' as const,
      title: 'Nassau',
      subtitle: 'Front, Back, Overall',
      meta: '2 to 4 buy-in players',
      disabled: false,
    },
    {
      key: 'wolf' as const,
      title: 'Wolf',
      subtitle: 'Rotating Wolf order',
      meta: participants.length === 4 ? 'Ready for 4 players' : 'Requires exactly 4 players',
      disabled: false,
    },
  ]), [participants.length]);

  useEffect(() => {
    setNassauSelectedParticipantIds((current) => {
      const filtered = current.filter((participantId) => validParticipantIds.includes(participantId));
      const next =
        filtered.length > 0 || groupGameMode !== 'nassau'
          ? filtered
          : validParticipantIds.slice(0, Math.min(2, validParticipantIds.length));

      if (sameStringSet(current, next)) return current;
      return next;
    });
  }, [groupGameMode, validParticipantIds]);

  useEffect(() => {
    setWolfOrderParticipantIds((current) => {
      const next = sanitizeWolfOrder(wolfParticipantIds, current);
      return sameStringSet(current, next) && current.every((participantId, index) => next[index] === participantId)
        ? current
        : next;
    });
  }, [wolfParticipantIds]);

  useEffect(() => {
    if (groupGameMode !== 'wolf') return;
    setWolfScoringMode((current) => current ?? 'winner_only');
  }, [groupGameMode]);

  const rating = ratingInfoFor(tee, ratingType) as { rating: string | number; slope: string | number } | null;

  const getSeatValues = (seat: EditableSeat) => {
    if (seat === 2) return { firstName: guestOneFirst, lastName: guestOneLast };
    if (seat === 3) return { firstName: guestTwoFirst, lastName: guestTwoLast };
    return { firstName: guestThreeFirst, lastName: guestThreeLast };
  };

  const setSeatValues = (seat: EditableSeat, firstName: string, lastName: string, identity: SeatIdentity | null = null) => {
    setSeatIdentities((current) => ({ ...current, [seat]: identity }));
    if (seat === 2) {
      setGuestOneFirst(firstName);
      setGuestOneLast(lastName);
      return;
    }
    if (seat === 3) {
      setGuestTwoFirst(firstName);
      setGuestTwoLast(lastName);
      return;
    }
    setGuestThreeFirst(firstName);
    setGuestThreeLast(lastName);
  };

  const clearSeat = (seat: EditableSeat) => {
    setSeatValues(seat, '', '');
    if (scorekeeperSeat === seat) setScorekeeperSeat(1);
    if (seatDraft?.seat === seat) setSeatDraft(null);
  };

  const beginSeatEdit = (seat: EditableSeat, mode: SeatEditorMode) => {
    const values = getSeatValues(seat);
    setSeatSearch('');
    setDebouncedSeatSearch('');
    setSearchResults([]);
    setSearchFailed(false);
    setSeatDraft({
      seat,
      mode,
      firstName: values.firstName,
      lastName: values.lastName,
    });
  };

  const seatHasPlayer = (seat: number) => {
    if (seat === 1) return true;
    if (seat === 2) return !!guestOneFirst.trim() && !!guestOneLast.trim();
    if (seat === 3) return !!guestTwoFirst.trim() && !!guestTwoLast.trim();
    if (seat === 4) return !!guestThreeFirst.trim() && !!guestThreeLast.trim();
    return false;
  };

  const selectExistingPlayer = (seat: EditableSeat, player: SearchPlayerResult) => {
    setSeatValues(seat, player.firstName.trim(), player.lastName.trim(), {
      userId: player.userId ?? null,
      guestProfileId: player.guestProfileId ?? null,
      displayName: player.displayName,
    });
    setSeatDraft(null);
    setSeatSearch('');
    setDebouncedSeatSearch('');
    setSearchResults([]);
    setSearchFailed(false);
  };

  const applySeatEntry = async (seat: EditableSeat) => {
    if (!seatDraft || seatDraft.seat !== seat) return;
    if (!seatDraft.firstName.trim() || !seatDraft.lastName.trim()) {
      Alert.alert('Missing name', `Enter both first and last name for Seat ${seat}.`);
      return;
    }

    try {
      setIsSavingSeat(true);

      let identity: SeatIdentity | null = null;
      if (seatDraft.mode === 'new' && user?.id) {
        const guestProfile = await ensureGuestProfile(user.id, seatDraft.firstName, seatDraft.lastName);
        identity = {
          userId: null,
          guestProfileId: guestProfile?.id ?? null,
          displayName: `${seatDraft.firstName.trim()} ${seatDraft.lastName.trim()}`.trim(),
        };
      }

      setSeatValues(seat, seatDraft.firstName.trim(), seatDraft.lastName.trim(), identity);
      setSeatDraft(null);
    } catch (error: any) {
      Alert.alert('Could not save player', error?.message ?? 'Try again.');
    } finally {
      setIsSavingSeat(false);
    }
  };

  const loadSavedGroupIntoBuilder = async (savedGroup: RecurringRoundGroup) => {
    if (!user?.id) {
      Alert.alert('Sign in required', 'Sign in before using saved groups.');
      return;
    }

    try {
      setLoadingSavedGroupId(savedGroup.id);
      const members = await getRecurringRoundGroupMembers(user.id, savedGroup.id);
      setGroupName(savedGroup.name);
      setSeatValues(2, '', '');
      setSeatValues(3, '', '');
      setSeatValues(4, '', '');

      members.forEach((member) => {
        if (member.seatOrder < 2 || member.seatOrder > 4) return;
        const seat = member.seatOrder as EditableSeat;
        setSeatValues(seat, member.firstName, member.lastName, {
          userId: member.userId,
          guestProfileId: member.guestProfileId,
          displayName: member.displayName,
        });
      });

      setScorekeeperSeat(1);
      setSaveAsRecurring(false);
      setLoadedSavedGroupId(savedGroup.id);
      setSeatDraft(null);
    } catch (error: any) {
      Alert.alert('Could not load saved group', error?.message ?? 'Try again.');
    } finally {
      setLoadingSavedGroupId(null);
    }
  };

  const ensureParticipantsForRecurringSave = async () => {
    if (!user?.id) throw new Error('Sign in before saving a recurring group.');

    const savedParticipants: GroupParticipant[] = [];
    for (const participant of participants) {
      if (participant.type === 'app_user') {
        savedParticipants.push({
          ...participant,
          id: participant.id === 'me' ? user.id : participant.id,
        });
        continue;
      }

      if (!participant.id.startsWith('guest-')) {
        savedParticipants.push(participant);
        continue;
      }

      const guestProfile = await ensureGuestProfile(user.id, participant.firstName, participant.lastName);
      if (!guestProfile?.id) {
        throw new Error(`Could not save ${participant.displayName} as a guest profile.`);
      }

      savedParticipants.push({
        ...participant,
        id: guestProfile.id,
      });
    }

    return savedParticipants;
  };

  const startFreshGroupRound = async () => {
    if (isSavingRound) return;

    const trimmedGroupName = groupName.trim();
    const sanitizedWolfOrder = groupGameMode === 'wolf'
      ? sanitizeWolfOrder(wolfParticipantIds, wolfOrderParticipantIds)
      : [];

    if (!trimmedGroupName) {
      Alert.alert('Missing group name', 'Please enter a group name.');
      return;
    }

    if (participants.length < 2) {
      Alert.alert('Add players', 'A group round should have at least two players.');
      return;
    }

    if (groupGameMode === 'bingo_bango_bongo' && participants.length < 3) {
      Alert.alert('Add one more player', 'Bingo Bango Bongo needs a group of 3 or 4 players.');
      return;
    }

    if (groupGameMode === 'bingo_bango_bongo' && participants.length > 4) {
      Alert.alert('Too many players', 'Bingo Bango Bongo supports a maximum of 4 players.');
      return;
    }

    if (groupGameMode === 'nassau' && participants.length > 4) {
      Alert.alert('Too many players', 'Nassau supports up to four players.');
      return;
    }

    if (groupGameMode === 'nassau' && nassauSelectedParticipantIds.length < 2) {
      Alert.alert('Choose Nassau players', 'Choose at least two Nassau players.');
      return;
    }

    if (groupGameMode === 'nassau' && nassauSelectedParticipantIds.length > 4) {
      Alert.alert('Too many players', 'Nassau supports up to four players.');
      return;
    }

    if (groupGameMode === 'wolf' && participants.length !== 4) {
      Alert.alert('Need four players', 'Wolf v1 requires exactly four players.');
      return;
    }

    if (groupGameMode === 'wolf') {
      if (
        sanitizedWolfOrder.length !== 4
        || new Set(sanitizedWolfOrder).size !== 4
        || !sameStringSet(sanitizedWolfOrder, wolfParticipantIds)
      ) {
        Alert.alert('Check Wolf order', 'Wolf order must contain each of the four players exactly once.');
        return;
      }
    }

    if (!seatHasPlayer(scorekeeperSeat)) {
      Alert.alert('Scorekeeper missing', 'Choose a scorekeeper seat that has a named player.');
      return;
    }

    const buyInCents =
      groupGameMode === 'bingo_bango_bongo'
        ? parseCurrencyInputToCents(bbbBuyIn)
        : groupGameMode === 'skins'
          ? parseCurrencyInputToCents(skinsBuyIn)
          : groupGameMode === 'nassau'
            ? parseCurrencyInputToCents(nassauBuyIn)
          : groupGameMode === 'wolf'
            ? parseCurrencyInputToCents(wolfBuyIn)
          : 0;
    if ((groupGameMode === 'bingo_bango_bongo' || groupGameMode === 'skins' || groupGameMode === 'nassau' || groupGameMode === 'wolf') && buyInCents === null) {
      Alert.alert('Invalid buy-in', 'Enter a nonnegative buy-in per player, like 20 or 20.00.');
      return;
    }

    try {
      setIsSavingRound(true);

      if (saveAsRecurring && groupSetupChoice === 'create') {
        const savedParticipants = await ensureParticipantsForRecurringSave();
        await saveRecurringRoundGroup({
          ownerUserId: user!.id,
          name: trimmedGroupName,
          participants: savedParticipants,
        });
      }

      const backendStart = user?.id
        ? await startRegularGroupRound({
            roundDate: date,
            scoringUserId: user.id,
            participants,
            gameType: getBackendGroupGameType(groupGameMode),
            gameName: getBackendGroupGameName(trimmedGroupName, groupGameMode),
            buyInCents:
              groupGameMode === 'bingo_bango_bongo' || groupGameMode === 'skins' || groupGameMode === 'nassau' || groupGameMode === 'wolf'
                ? buyInCents ?? 0
                : null,
            gameParticipantIds:
              groupGameMode === 'nassau'
                ? nassauSelectedParticipantIds
                : groupGameMode === 'wolf'
                  ? wolfParticipantIds
                  : null,
            gameConfig: groupGameMode === 'wolf'
              ? {
                  format: 'standard_wolf_v1',
                  participant_ids: wolfParticipantIds,
                  wolf_order_participant_ids: sanitizedWolfOrder,
                  scoring_mode: wolfScoringMode,
                  points: {
                    partner_win: 1,
                    lone_win: 3,
                    blind_win: 6,
                  },
                }
              : null,
          })
        : null;

      const round: LocalRoundDraft = {
        id: `${Date.now()}`,
        draftOwnerUserId: user?.id ?? null,
        date,
        tee,
        ratingType,
        currentHole: 1,
        roundMode: 'casual_group',
        scoringUserId: user?.id ?? null,
        groupGameMode,
        backendRoundId: backendStart?.round_id ?? null,
        backendRoundGameId: backendStart?.round_game_id ?? null,
        officialCurrentHole: backendStart?.current_official_hole ?? 1,
        officialCompletedHole: backendStart?.completed_official_hole ?? 0,
        roundGameBuyInCents:
          groupGameMode === 'bingo_bango_bongo' || groupGameMode === 'skins' || groupGameMode === 'nassau' || groupGameMode === 'wolf'
            ? buyInCents ?? 0
            : null,
        nassauParticipantIds: groupGameMode === 'nassau' ? nassauSelectedParticipantIds : null,
        wolfParticipantIds: groupGameMode === 'wolf' ? wolfParticipantIds : null,
        wolfOrderParticipantIds: groupGameMode === 'wolf' ? sanitizedWolfOrder : null,
        wolfScoringMode: groupGameMode === 'wolf' ? wolfScoringMode : null,
        wolfHoleDecisions: null,
        statsEnabled,
        group: {
          groupName: trimmedGroupName,
          participants,
        },
        holes: holes.map((courseHole) => ({
          hole: courseHole.hole,
          score: courseHole.par,
          groupScores: participants.map((participant) => ({
            participantId: participant.id,
            score: courseHole.par,
          })),
        })),
      };

      await saveDraftRound(round);
      router.replace('/round/hole/1');
    } catch (error: any) {
      if (isDuplicateRecurringGroupNameError(error)) {
        showDuplicateRecurringGroupNameAlert();
      } else {
        Alert.alert('Could not start group round', error?.message ?? 'Try again.');
      }
    } finally {
      setIsSavingRound(false);
    }
  };

  const handleStart = async () => {
    const existingDraft = await loadDraftRound();
    if (existingDraft && existingDraft.roundMode !== 'tournament') {
      Alert.alert(
        'Delete current round first?',
        `A ${describeCurrentRound(existingDraft)} is still on this device. Delete it before starting a new round so no stale state carries forward.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Resume Current Round',
            onPress: () => router.replace('/(tabs)/round'),
          },
          {
            text: 'Delete and Start New',
            style: 'destructive',
            onPress: async () => {
              const result = await deleteCurrentRound(existingDraft);
              await startFreshGroupRound();
              if (result.backendCleanupError) {
                Alert.alert(
                  'Started fresh locally',
                  'The old local draft was cleared, but backend draft cleanup did not finish.',
                );
              }
            },
          },
        ],
      );
      return;
    }

    await startFreshGroupRound();
  };

  const moveWolfOrderParticipant = (participantId: string, direction: -1 | 1) => {
    setWolfOrderParticipantIds((current) => {
      const currentIndex = current.indexOf(participantId);
      if (currentIndex === -1) return current;
      const nextIndex = currentIndex + direction;
      if (nextIndex < 0 || nextIndex >= current.length) return current;
      const next = [...current];
      const [movedParticipantId] = next.splice(currentIndex, 1);
      next.splice(nextIndex, 0, movedParticipantId);
      return next;
    });
  };

  return (
    <BrandWatermarkBackground screenName="StartGroupRoundScreen">
      <CoalCreekHeader />
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <View style={styles.welcomeWrap}>
          <Text style={styles.welcomeTitle}>Welcome back, {welcomeName}!</Text>
          <Text style={styles.welcomeSubtitle}>Let's play some golf.</Text>
        </View>

        <RoundHeroActionCard
          title="Group Round"
          subtitle="Score together in real time"
          imageSource={require('@/assets/images/group-round-hero.jpg')}
          testID="group-round-hero-card"
        />

        {groupSetupChoice === 'choose' ? (
          <SectionCard style={styles.fullChoiceCard}>
            <Text style={styles.sectionTitle}>Choose group setup</Text>
            <Text style={styles.helper}>Start from a saved recurring group or build a new regular-round group.</Text>
            <PlayerCardGrid>
              <PlayerCard
                title="Use Saved Group"
                subtitle="Load a recurring group"
                meta="Members fill the seat grid and stay editable"
                onPress={() => setGroupSetupChoice('saved')}
                style={styles.choicePlayerCard}
              />
              <PlayerCard
                title="Create New Group"
                subtitle="Build from scratch"
                meta="Optionally save it as recurring before starting"
                onPress={() => {
                  setGroupSetupChoice('create');
                  setLoadedSavedGroupId(null);
                }}
                style={styles.choicePlayerCard}
              />
            </PlayerCardGrid>
          </SectionCard>
        ) : null}

        {groupSetupChoice === 'saved' && !loadedSavedGroupId ? (
          <SectionCard style={styles.fullChoiceCard}>
            <Text style={styles.sectionTitle}>Saved Groups</Text>
            <Text style={styles.helper}>Pick a recurring group to load into the normal seat grid.</Text>
            {savedGroupsLoading ? (
              <Text style={styles.helper}>Loading saved groups...</Text>
            ) : savedGroupsError ? (
              <Text style={styles.errorText}>{savedGroupsError}</Text>
            ) : savedGroups.length > 0 ? (
              <View style={styles.savedGroupList}>
                {savedGroups.map((savedGroup) => (
                  <AppButton
                    key={savedGroup.id}
                    title={loadingSavedGroupId === savedGroup.id ? 'Loading...' : savedGroup.name}
                    onPress={() => void loadSavedGroupIntoBuilder(savedGroup)}
                    variant="secondary"
                    disabled={!!loadingSavedGroupId}
                  />
                ))}
              </View>
            ) : (
              <SectionCard style={{ backgroundColor: '#eef3ec', padding: 12 }}>
                <Text style={styles.meta}>No saved recurring groups yet.</Text>
                <Text style={styles.meta}>Create a new group and turn on Save this as recurring group.</Text>
              </SectionCard>
            )}
            <View style={styles.cardActionRow}>
              <AppButton
                title="Back"
                onPress={() => setGroupSetupChoice('choose')}
                variant="secondary"
                style={styles.cardActionButton}
                disabled={!!loadingSavedGroupId}
              />
              <AppButton
                title="Create New Group"
                onPress={() => {
                  setGroupSetupChoice('create');
                  setLoadedSavedGroupId(null);
                }}
                style={styles.cardActionButton}
                disabled={!!loadingSavedGroupId}
              />
            </View>
          </SectionCard>
        ) : null}

      {groupSetupChoice !== 'choose' && (groupSetupChoice !== 'saved' || loadedSavedGroupId) ? (
        <>
      <SectionCard style={{ gap: 16 }}>
        <AppInput label="Group name" value={groupName} onChangeText={setGroupName} />
        <AppInput label="Round date" value={date} onChangeText={setDate} />

        <Text style={styles.label}>Tee</Text>
        <View style={styles.chips}>
          {teeOptions.map((option) => (
            <AppButton
              key={option}
              title={option}
              onPress={() => setTee(option)}
              variant={tee === option ? 'primary' : 'secondary'}
              style={styles.chipButton}
            />
          ))}
        </View>

        <View style={styles.inlineRow}>
          <AppButton
            title="Men's Rating"
            onPress={() => setRatingType('men')}
            variant={ratingType === 'men' ? 'primary' : 'secondary'}
            style={{ flex: 1 }}
          />
          <AppButton
            title="Women's Rating"
            onPress={() => setRatingType('women')}
            variant={ratingType === 'women' ? 'primary' : 'secondary'}
            style={{ flex: 1 }}
          />
        </View>

        <SectionCard style={{ backgroundColor: '#eef3ec', padding: 12 }}>
          <Text style={styles.meta}>Total yardage: {totalYardageForTee(tee)}</Text>
          <Text style={styles.meta}>
            Rating info: {rating ? `${rating.rating} / ${rating.slope}` : 'Not posted for this tee/rating set'}
          </Text>
        </SectionCard>
      </SectionCard>

      <SectionCard style={{ gap: 14 }}>
        <Text style={styles.sectionTitle}>Players</Text>
        <Text style={styles.helper}>Use the 2x2 seat grid to fill up to four players. Seat 1 stays as the app user.</Text>

        {seatDraft ? (
          <SectionCard style={styles.fullSeatEditor}>
            <Text style={styles.fullSeatEditorTitle}>{`Editing Seat ${seatDraft.seat}`}</Text>
            <Text style={styles.helper}>
              {seatDraft.mode === 'existing'
                ? 'Search existing players and tap one to fill this seat.'
                : 'Enter a new player name for this seat, then save.'}
            </Text>

            <View style={styles.cardActionRow}>
              <AppButton
                title="Select Existing"
                onPress={() => beginSeatEdit(seatDraft.seat, 'existing')}
                variant={seatDraft.mode === 'existing' ? 'primary' : 'secondary'}
                style={styles.cardActionButton}
              />
              <AppButton
                title="Add New"
                onPress={() => beginSeatEdit(seatDraft.seat, 'new')}
                variant={seatDraft.mode === 'new' ? 'primary' : 'secondary'}
                style={styles.cardActionButton}
              />
            </View>

            {seatDraft.mode === 'existing' ? (
              <>
                <AppInput
                  label="Search existing players"
                  value={seatSearch}
                  onChangeText={setSeatSearch}
                  placeholder="Search by first name, last name, or full name"
                />
                {seatSearch.trim().length === 0 ? (
                  <Text style={styles.helper}>
                    Start typing to search existing players.
                  </Text>
                ) : searchResults.length > 0 ? (
                  <View style={styles.fullEditorGuestList}>
                    {searchResults.map((player) => (
                      <AppButton
                        key={`${seatDraft.seat}-${player.source}-${player.userId ?? player.guestProfileId ?? player.displayName}`}
                        title={
                          player.source === 'guest_profile'
                            ? `${player.displayName} · Saved guest`
                            : player.source === 'round_participant'
                              ? `${player.displayName} · Prior round`
                              : player.source === 'local'
                                ? `${player.displayName} · Local fallback`
                                : player.displayName
                        }
                        onPress={() => selectExistingPlayer(seatDraft.seat, player)}
                        variant="secondary"
                        style={styles.fullEditorGuestButton}
                      />
                    ))}
                  </View>
                ) : (
                  <Text style={styles.helper}>
                    {searchFailed
                      ? 'Backend search failed, so only local fallback names were checked. Try another name or switch to Add New.'
                      : 'No matching backend-backed players found. Try another name or switch to Add New.'}
                  </Text>
                )}
              </>
            ) : (
              <>
                <AppInput
                  label="First name"
                  value={seatDraft.firstName}
                  onChangeText={(value) => setSeatDraft((current) => (current ? { ...current, firstName: value } : current))}
                />
                <AppInput
                  label="Last name"
                  value={seatDraft.lastName}
                  onChangeText={(value) => setSeatDraft((current) => (current ? { ...current, lastName: value } : current))}
                />
              </>
            )}

            <View style={styles.cardActionRow}>
              <AppButton
                title="Cancel"
                onPress={() => setSeatDraft(null)}
                variant="secondary"
                style={seatDraft.mode === 'existing' ? undefined : styles.cardActionButton}
                disabled={isSavingSeat}
              />
              {seatDraft.mode === 'new' ? (
                <AppButton
                  title={isSavingSeat ? 'Saving...' : 'Save'}
                  onPress={() => void applySeatEntry(seatDraft.seat)}
                  style={styles.cardActionButton}
                  disabled={isSavingSeat}
                />
              ) : null}
            </View>
          </SectionCard>
        ) : (
          <PlayerCardGrid>
            <PlayerCard
              title="Seat 1"
              subtitle={`${meFirst} ${meLast}`.trim()}
              meta={`App user${scorekeeperSeat === 1 ? ' · Scorekeeper' : ''}`}
              selected={scorekeeperSeat === 1}
            />

            {[2, 3, 4].map((seat) => {
              const editableSeat = seat as EditableSeat;
              const values = getSeatValues(editableSeat);
              const identity = seatIdentities[editableSeat];
              const hasPlayer = !!values.firstName.trim() && !!values.lastName.trim();
              const playerKind = identity?.userId ? 'App user' : identity?.guestProfileId ? 'Saved guest' : 'Guest player';

              return (
                <PlayerCard
                  key={seat}
                  title={`Seat ${seat}`}
                  subtitle={hasPlayer ? `${values.firstName.trim()} ${values.lastName.trim()}` : 'Open seat'}
                  meta={
                    hasPlayer
                      ? `${scorekeeperSeat === seat ? 'Scorekeeper · ' : ''}${playerKind}`
                      : 'Select an existing guest or add a new one'
                  }
                  selected={scorekeeperSeat === seat}
                  placeholder={!hasPlayer}
                >
                  {hasPlayer ? (
                    <View style={styles.cardActionRow}>
                      <AppButton
                        title="Change"
                        onPress={() => beginSeatEdit(editableSeat, 'existing')}
                        variant="secondary"
                        style={styles.cardActionButton}
                      />
                      <AppButton
                        title="Clear"
                        onPress={() => clearSeat(editableSeat)}
                        variant="ghost"
                        style={styles.cardActionButton}
                      />
                    </View>
                  ) : (
                    <View style={styles.cardActionStack}>
                      <AppButton
                        title="Select Existing"
                        onPress={() => beginSeatEdit(editableSeat, 'existing')}
                        variant="secondary"
                      />
                      <AppButton
                        title="Add New"
                        onPress={() => beginSeatEdit(editableSeat, 'new')}
                        variant="ghost"
                      />
                    </View>
                  )}
                </PlayerCard>
              );
            })}
          </PlayerCardGrid>
        )}
      </SectionCard>

      {groupSetupChoice === 'create' ? (
        <SectionCard style={{ gap: 12 }}>
          <Text style={styles.sectionTitle}>Recurring group</Text>
          <Text style={styles.helper}>Save only this member list and group name for future regular group rounds.</Text>
          <AppButton
            title={saveAsRecurring ? 'Save this as recurring group: On' : 'Save this as recurring group: Off'}
            onPress={() => setSaveAsRecurring((current) => !current)}
            variant={saveAsRecurring ? 'primary' : 'secondary'}
          />
        </SectionCard>
      ) : null}

      <SectionCard style={{ gap: 14 }}>
        <Text style={styles.sectionTitle}>Scorekeeper</Text>
        <Text style={styles.helper}>Pick the seat that is keeping the group card.</Text>
        <PlayerCardGrid>
          {[1, 2, 3, 4].map((seat) => (
            <PlayerCard
              key={`scorekeeper-${seat}`}
              title={`Seat ${seat}`}
              subtitle={seatHasPlayer(seat) ? (seat === 1 ? `${meFirst} ${meLast}`.trim() : `${getSeatValues(seat as EditableSeat).firstName.trim()} ${getSeatValues(seat as EditableSeat).lastName.trim()}`) : 'Open seat'}
              meta={seatHasPlayer(seat) ? (scorekeeperSeat === seat ? 'Current scorekeeper' : 'Available scorekeeper') : 'Add a player first'}
              onPress={() => setScorekeeperSeat(seat)}
              selected={scorekeeperSeat === seat}
              disabled={!seatHasPlayer(seat)}
              placeholder={!seatHasPlayer(seat)}
            />
          ))}
        </PlayerCardGrid>
      </SectionCard>

      <SectionCard style={{ gap: 14 }}>
        <Text style={styles.sectionTitle}>Games</Text>
        <Text style={styles.helper}>Choose an optional side game for this group. Standard keeps regular scoring only.</Text>
        <PlayerCardGrid>
          {gameChoices.map((choice) => {
            const selected = groupGameMode === choice.key;
            return (
              <PlayerCard
                key={choice.key}
                title={choice.title}
                subtitle={choice.subtitle}
                meta={choice.meta}
                selected={selected}
                disabled={choice.disabled}
                onPress={() => setGroupGameMode(choice.key)}
                style={styles.gameChoiceCard}
                bodyStyle={styles.gameChoiceBody}
              >
                <View style={[styles.gameChoiceBadge, selected ? styles.gameChoiceBadgeSelected : styles.gameChoiceBadgeIdle]}>
                  {selected ? <MaterialIcons name="check-circle" size={14} color="#0f5f2c" /> : <MaterialIcons name="radio-button-unchecked" size={14} color="#5a6b61" />}
                  <Text style={[styles.gameChoiceBadgeText, selected ? styles.gameChoiceBadgeTextSelected : null]}>
                    {selected ? 'Selected' : 'Tap to choose'}
                  </Text>
                </View>
              </PlayerCard>
            );
          })}
        </PlayerCardGrid>
        {groupGameMode === 'bingo_bango_bongo' ? (
          <SectionCard style={{ backgroundColor: '#eef3ec', padding: 12 }}>
            <Text style={styles.meta}>BBB is only for regular group rounds.</Text>
            <Text style={styles.meta}>Enter every player score on each hole, then assign Bingo, Bango, and Bongo manually.</Text>
              <Text style={styles.meta}>BBB scoring stays separate from your personal round stats. Turn stats on below if players want normal round tracking too.</Text>
            <AppInput
              label="Buy-in per player"
              value={bbbBuyIn}
              onChangeText={setBbbBuyIn}
              placeholder="0.00"
              keyboardType="decimal-pad"
            />
            <Text style={styles.meta}>Current pot at start: {formatCurrencyFromCents((parseCurrencyInputToCents(bbbBuyIn) ?? 0) * participants.length)}</Text>
          </SectionCard>
        ) : null}
        {groupGameMode === 'skins' ? (
          <SectionCard style={{ backgroundColor: '#eef3ec', padding: 12 }}>
            <Text style={styles.meta}>Skins is only for regular group rounds.</Text>
            <Text style={styles.meta}>Enter a gross score for every player on each hole. Lowest unique score wins the skin.</Text>
            <Text style={styles.meta}>Tied low scores push the skin forward until a later hole has a unique winner.</Text>
            <AppInput
              label="Buy-in per player"
              value={skinsBuyIn}
              onChangeText={setSkinsBuyIn}
              placeholder="0.00"
              keyboardType="decimal-pad"
            />
            <Text style={styles.meta}>Current pot at start: {formatCurrencyFromCents((parseCurrencyInputToCents(skinsBuyIn) ?? 0) * participants.length)}</Text>
          </SectionCard>
        ) : null}
        {groupGameMode === 'nassau' ? (
          <SectionCard style={{ backgroundColor: '#eef3ec', padding: 12 }}>
            <Text style={styles.meta}>Nassau v1 is an individual game for 2 to 4 players.</Text>
            <Text style={styles.meta}>Front 9, Back 9, and Overall 18 each pay one equal share of the total pot.</Text>
            <Text style={styles.meta}>Tied segment winners split that segment share equally.</Text>
            <AppInput
              label="Buy-in per player"
              value={nassauBuyIn}
              onChangeText={setNassauBuyIn}
              placeholder="0.00"
              keyboardType="decimal-pad"
            />
            <Text style={styles.sectionTitle}>Nassau players</Text>
            <Text style={styles.helper}>Choose the players buying into Nassau. The full group round can still include everyone.</Text>
            <View style={styles.savedGroupList}>
              {participants.map((participant) => {
                const selected = nassauSelectedParticipantIds.includes(participant.id);
                return (
                  <View key={participant.id} style={styles.nassauPlayerOptionWrap}>
                    <AppButton
                      title={selected ? `${participant.displayName} Selected` : `${participant.displayName} Not in Nassau`}
                      onPress={() =>
                        setNassauSelectedParticipantIds((current) => {
                          const next = current.includes(participant.id)
                            ? current.filter((participantId) => participantId !== participant.id)
                            : [...current, participant.id];
                          return next;
                        })
                      }
                      variant={selected ? 'primary' : 'secondary'}
                    />
                    {selected ? (
                      <View style={styles.nassauCheckBadge}>
                        <MaterialIcons name="check" size={12} color="#fffdf8" />
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </View>
            <Text style={styles.meta}>
              Nassau buy-in players selected: {nassauSelectedParticipantIds.length}
            </Text>
            <Text style={styles.meta}>
              Current pot at start: {formatCurrencyFromCents((parseCurrencyInputToCents(nassauBuyIn) ?? 0) * nassauSelectedParticipantIds.length)}
            </Text>
          </SectionCard>
        ) : null}
        {groupGameMode === 'wolf' ? (
          <SectionCard style={{ backgroundColor: '#eef3ec', padding: 12 }}>
            <Text style={styles.meta}>Wolf v1 is a four-player regular-round game.</Text>
            <Text style={styles.meta}>The Wolf rotates every hole and chooses one partner or plays alone.</Text>
            <Text style={styles.meta}>Set the full order now. Hole 1 starts with the first Wolf, then rotates in that order.</Text>
            <AppInput
              label="Buy-in per player"
              value={wolfBuyIn}
              onChangeText={setWolfBuyIn}
              placeholder="0.00"
              keyboardType="decimal-pad"
            />
            <Text style={styles.sectionTitle}>Scoring Style</Text>
            <Text style={styles.helper}>Choose whether losing sides lose points or stay at zero.</Text>
            <PlayerCardGrid>
              <PlayerCard
                title="Net points"
                subtitle="Current plus/minus style"
                meta="Winners gain points, losing side loses points."
                selected={wolfScoringMode === 'net'}
                onPress={() => setWolfScoringMode('net')}
              />
              <PlayerCard
                title="Winner-only"
                subtitle="No negative points"
                meta="Winners gain points, losing side stays at 0."
                selected={wolfScoringMode === 'winner_only'}
                onPress={() => setWolfScoringMode('winner_only')}
              />
            </PlayerCardGrid>
            <Text style={styles.sectionTitle}>Wolf order</Text>
            {wolfOrderParticipants.length === 4 ? (
              <View style={styles.savedGroupList}>
                {wolfOrderParticipants.map((participant, index) => (
                  <View key={`wolf-order-${participant.id}`} style={styles.wolfOrderRow}>
                    <View style={styles.wolfOrderIdentity}>
                      <Text style={styles.wolfOrderIndex}>Hole {index + 1}</Text>
                      <Text style={styles.wolfOrderName}>{participant.displayName}</Text>
                    </View>
                    <View style={styles.wolfOrderActions}>
                      <AppButton
                        title="Up"
                        onPress={() => moveWolfOrderParticipant(participant.id, -1)}
                        variant="secondary"
                        compact
                        disabled={index === 0}
                        style={styles.wolfOrderActionButton}
                      />
                      <AppButton
                        title="Down"
                        onPress={() => moveWolfOrderParticipant(participant.id, 1)}
                        variant="secondary"
                        compact
                        disabled={index === wolfOrderParticipants.length - 1}
                        style={styles.wolfOrderActionButton}
                      />
                    </View>
                  </View>
                ))}
              </View>
            ) : (
              <Text style={styles.meta}>Add exactly four players to start Wolf.</Text>
            )}
            <Text style={styles.meta}>Current pot at start: {formatCurrencyFromCents((parseCurrencyInputToCents(wolfBuyIn) ?? 0) * wolfParticipantIds.length)}</Text>
          </SectionCard>
        ) : null}
      </SectionCard>

      <SectionCard style={{ gap: 12 }}>
        <Text style={styles.sectionTitle}>Stats</Text>
        <Text style={styles.helper}>
          {groupGameMode === 'bingo_bango_bongo' || groupGameMode === 'skins' || groupGameMode === 'nassau'
            || groupGameMode === 'wolf'
            ? 'These are personal round stats. They do not change the selected game scoring.'
            : 'Default is on each round. Turn them off if this group only wants to enter score.'}
        </Text>
        <View style={styles.inlineRow}>
          <AppButton
            title="Stats On"
            onPress={() => setStatsEnabled(true)}
            variant={statsEnabled ? 'primary' : 'secondary'}
            style={{ flex: 1 }}
          />
          <AppButton
            title="No Stats"
            onPress={() => setStatsEnabled(false)}
            variant={!statsEnabled ? 'primary' : 'secondary'}
            style={{ flex: 1 }}
          />
        </View>
      </SectionCard>

        </>
      ) : null}
      </ScrollView>
      <PlayerBottomNav />
    </BrandWatermarkBackground>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  content: { padding: 16, gap: 16, paddingBottom: 112 },
  welcomeWrap: { gap: 6 },
  welcomeTitle: { fontSize: 30, lineHeight: 34, fontWeight: '800', color: '#132117' },
  welcomeSubtitle: { fontSize: 17, lineHeight: 24, color: '#5a6b61' },
  label: { fontSize: 15, fontWeight: '800', color: '#132117' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  chipButton: { minWidth: 120 },
  inlineRow: { flexDirection: 'row', gap: 10 },
  meta: { fontSize: 14, color: '#132117', lineHeight: 20 },
  sectionTitle: { fontSize: 18, fontWeight: '800', color: '#132117' },
  helper: { fontSize: 13, color: '#5a6b61', lineHeight: 19 },
  errorText: { fontSize: 13, color: '#8f2f22', lineHeight: 19 },
  fullChoiceCard: { gap: 16, minHeight: 320, justifyContent: 'center' },
  choicePlayerCard: { minHeight: 168 },
  gameChoiceCard: { minHeight: 156 },
  gameChoiceBody: { marginTop: 'auto' },
  gameChoiceBadge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  gameChoiceBadgeIdle: {
    backgroundColor: '#f8f5ee',
    borderWidth: 1,
    borderColor: '#d8d1c4',
  },
  gameChoiceBadgeSelected: {
    backgroundColor: '#dcebd8',
    borderWidth: 1,
    borderColor: '#6f8a57',
  },
  gameChoiceBadgeText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#5a6b61',
  },
  gameChoiceBadgeTextSelected: {
    color: '#0f5f2c',
  },
  savedGroupList: { gap: 10 },
  nassauPlayerOptionWrap: {
    position: 'relative',
  },
  nassauCheckBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#18341d',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#6f8a57',
  },
  wolfOrderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: '#f8f5ee',
    borderWidth: 1,
    borderColor: '#d8d1c4',
  },
  wolfOrderIdentity: {
    flex: 1,
    gap: 4,
  },
  wolfOrderIndex: {
    fontSize: 12,
    fontWeight: '800',
    color: '#5a6b61',
    textTransform: 'uppercase',
  },
  wolfOrderName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#132117',
  },
  wolfOrderActions: {
    flexDirection: 'row',
    gap: 8,
  },
  wolfOrderActionButton: {
    minWidth: 64,
  },
  cardActionRow: { flexDirection: 'row', gap: 8 },
  cardActionStack: { gap: 8 },
  cardActionButton: { flex: 1, minHeight: 42 },
  fullSeatEditor: {
    gap: 12,
    padding: 14,
    backgroundColor: '#eef3ec',
    borderColor: '#18341d',
  },
  fullSeatEditorTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#132117',
  },
  fullEditorGuestList: { gap: 8 },
  fullEditorGuestButton: { minHeight: 42 },
});

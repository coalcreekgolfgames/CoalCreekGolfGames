import type { RatingType, TeeOption } from '@/constants/course';

export type GroupParticipant = {
  id: string;
  type: 'app_user' | 'guest';
  firstName: string;
  lastName: string;
  displayName: string;
  isScorekeeper?: boolean;
  selectedTee?: TeeOption | null;
};

export type GroupGameMode = 'none' | 'bingo_bango_bongo' | 'skins' | 'nassau' | 'wolf';
export type WolfScoringMode = 'net' | 'winner_only';
export type RegularRoundBackendGameType = 'standard' | 'bingo_bango_bongo' | 'skins' | 'nassau' | 'wolf';
export type RegularRoundBackendSyncStatus = 'synced' | 'sync_pending' | 'sync_failed' | 'retry_scheduled' | 'cancelled';
export type RegularRoundBackendChunkStatus = 'pending' | 'syncing' | 'synced' | 'failed' | 'retry_scheduled' | 'cancelled';
export type RegularRoundBackendChunkType =
  | 'round_setup'
  | 'hole_official'
  | 'hole_game'
  | 'hole_stats'
  | 'hole_mirror'
  | 'finalize_round'
  | 'finalize_game';

export type RegularRoundBackendSyncChunk = {
  key: string;
  chunkType: RegularRoundBackendChunkType;
  holeNumber?: number | null;
  status: RegularRoundBackendChunkStatus;
  attemptCount: number;
  lastError?: string | null;
  updatedAt: string;
  lastAttemptAt?: string | null;
  retryScheduledAt?: string | null;
};

export type RegularRoundBackendSyncState = {
  gameType: RegularRoundBackendGameType;
  status: RegularRoundBackendSyncStatus;
  pendingHoleNumbers: number[];
  chunks?: RegularRoundBackendSyncChunk[];
  finalizeRequested?: boolean;
  lastAttemptAt?: string | null;
  lastSuccessAt?: string | null;
  lastError?: string | null;
  retryScheduledAt?: string | null;
};

export type GroupHolePlayerScore = {
  participantId: string;
  score?: number | null;
};

export type WolfHoleDecisionDraft = {
  wolfParticipantId: string;
  partnerParticipantId: string | null;
  isLoneWolf: boolean;
  isBlindWolf: boolean;
};

export type HoleDraft = {
  hole: number;
  groupScores?: GroupHolePlayerScore[];
  bingoWinnerId?: string | null;
  bangoWinnerId?: string | null;
  bongoWinnerId?: string | null;
  skinsWinnerId?: string | null;
  skinsWinningScore?: number | null;
  skinsIsPush?: boolean | null;
  skinsCarryoverCount?: number | null;
  skinsAwardedCount?: number | null;
  nassauWinnerId?: string | null;
  nassauWinningScore?: number | null;
  nassauIsHalved?: boolean | null;
  wolfPartnerParticipantId?: string | null;
  wolfIsLoneWolf?: boolean | null;
  wolfIsBlindWolf?: boolean | null;
  wolfWinningSide?: 'wolf_side' | 'hunters' | 'tie' | null;
  driveSafe?: boolean | null;
  drivePenalty?: boolean | null;
  hitGreen?: boolean | null;
  girMissPenalty?: boolean | null;
  nearGreen?: boolean | null;
  score?: number | null;
  opponentScore?: number | null;
  onePutt?: boolean | null;
  threePutt?: boolean | null;
  totalPutts?: number | null;
  upAndDownMade?: boolean | null;
  note?: string;
  stablefordPoints?: number | null;
  stablefordBasis?: 'gross' | 'net' | null;
  stablefordResultLabel?: string | null;
  stablefordNetStrokes?: number | null;
  stablefordHandicapStrokes?: number | null;
  stablefordHandicapStatus?: TournamentStablefordHandicapStatus | null;
};

export type RoundMode = 'solo' | 'casual_group' | 'tournament';
export type TournamentFormatType =
  | 'individual_stroke_play'
  | 'scramble'
  | 'ironman_team_scramble'
  | 'singles_match_play'
  | 'match_play_bracket'
  | string;
export type TournamentScoringMode = 'individual' | 'team' | 'team_vs_team';
export type TournamentScoringFormat = 'stroke_play' | 'stableford' | 'match_play' | string;
export type TournamentStablefordMode = 'standard' | 'net' | 'modified' | string;
export type TournamentStablefordModifiedPreset = 'club_default' | string;
export type TournamentStablefordHandicapStatus = 'not_applicable' | 'ready' | 'fallback_gross_pending_handicap';
export type TournamentStablefordHandicapSource =
  | 'not_applicable'
  | 'profile'
  | 'missing_profile'
  | 'missing_rating'
  | 'disabled';
export type MatchPlayScoringMode = 'gross' | 'net';
export type MatchPlayHandicapMode = 'none' | 'full_difference';
export type MatchPlayTieHandling = 'sudden_death_playoff' | 'committee_decision' | 'allow_tie';
export type MatchPlayHoleWinner = 'a' | 'b' | 'halved';
export type MatchPlayConcededBy = 'a' | 'b';
export type MatchPlayConcessionType = 'none' | 'stroke' | 'hole' | 'match';

export type TournamentSpecialHoleRule = {
  hole_number: number;
  must_hole_out?: boolean | null;
  track_stroke_tally?: boolean | null;
};

export type GroupInfo = {
  groupName: string;
  participants: GroupParticipant[];
};

export type GolfCanadaPostingStatus = 'not_posted' | 'posted_manually';

export type GolfCanadaPostingRecord = {
  provider: 'golf_canada';
  method: 'manual';
  status: GolfCanadaPostingStatus;
  postedAt?: string | null;
  playedAlone?: boolean | null;
  playedWithOthers?: boolean | null;
};

export type RoundPostingStates = {
  golfCanada?: GolfCanadaPostingRecord | null;
};

export type PendingHoleScoreSync = {
  holeNumber: number;
  strokes: number;
  opponentScore?: number | null;
  status: 'pending' | 'failed';
  queuedAt: string;
  lastAttemptAt?: string | null;
  lastError?: string | null;
};

export type LocalRoundDraft = {
  id: string;
  draftOwnerUserId?: string | null;
  date: string;
  tee: TeeOption;
  ratingType: RatingType;
  currentHole: number;
  holeSequence?: number[];
  startingHole?: number | null;
  holes: HoleDraft[];
  roundMode?: RoundMode;
  group?: GroupInfo | null;
  groupGameMode?: GroupGameMode | null;
  tournamentId?: string | null;
  tournamentName?: string | null;
  tournamentFormat?: TournamentFormatType | null;
  tournamentScoringMode?: TournamentScoringMode | null;
  tournamentScoringFormat?: TournamentScoringFormat | null;
  tournamentStablefordMode?: TournamentStablefordMode | null;
  tournamentStablefordModifiedPreset?: TournamentStablefordModifiedPreset | null;
  tournamentHandicapEnabled?: boolean | null;
  tournamentHoleCount?: number | null;
  tournamentUnlimitedRoundsAllowed?: boolean | null;
  tournamentBestRoundsCount?: number | null;
  tournamentSpecialHoleRules?: TournamentSpecialHoleRule[] | null;
  tournamentStablefordHandicapStatus?: TournamentStablefordHandicapStatus | null;
  tournamentStablefordHandicapSource?: TournamentStablefordHandicapSource | null;
  tournamentPlayerHandicap?: number | null;
  tournamentCourseHandicap?: number | null;
  tournamentStablefordTotal?: number | null;
  tournamentMatchId?: string | null;
  tournamentMatchScoringMode?: MatchPlayScoringMode | null;
  tournamentMatchHandicapMode?: MatchPlayHandicapMode | null;
  tournamentMatchTieHandling?: MatchPlayTieHandling | null;
  tournamentTeamId?: string | null;
  tournamentTeamName?: string | null;
  tournamentPairingId?: string | null;
  tournamentOpponentTeamId?: string | null;
  tournamentOpponentTeamName?: string | null;
  tournamentPlayGroupId?: string | null;
  tournamentPlayGroupName?: string | null;
  tournamentTeeTime?: string | null;
  tournamentCrossCardTargetUserId?: string | null;
  tournamentCrossCardTargetName?: string | null;
  backendRoundId?: string | null;
  backendRoundGameId?: string | null;
  backendRoundParticipantIds?: Record<string, string> | null;
  officialCurrentHole?: number | null;
  officialCompletedHole?: number | null;
  liveProgressStartedAt?: string | null;
  liveProgressUpdatedAt?: string | null;
  roundGameBuyInCents?: number | null;
  nassauParticipantIds?: string[] | null;
  wolfParticipantIds?: string[] | null;
  wolfOrderParticipantIds?: string[] | null;
  wolfScoringMode?: WolfScoringMode | null;
  wolfHoleDecisions?: Record<number, WolfHoleDecisionDraft> | null;
  skinsPuttOffWinnerId?: string | null;
  skinsPuttOffAwardedCount?: number | null;
  skinsPuttOffResolvedAt?: string | null;
  scoringUserId?: string | null;
  backendSyncState?: 'idle' | 'score_only' | 'finalizing' | 'finalized' | 'error';
  regularRoundBackendSync?: RegularRoundBackendSyncState | null;
  bbbSyncState?: 'idle' | 'syncing' | 'synced' | 'error';
  bbbLastSyncAt?: string | null;
  bbbLastSyncError?: string | null;
  skinsSyncState?: 'idle' | 'syncing' | 'synced' | 'error';
  skinsLastSyncAt?: string | null;
  skinsLastSyncError?: string | null;
  statsEnabled?: boolean;
  pendingScoreSyncs?: PendingHoleScoreSync[];
  lastScoreSyncAt?: string | null;
  lastSyncError?: string | null;
  postingStates?: RoundPostingStates | null;
};

export type SavedRound = LocalRoundDraft & {
  savedAt: string;
  totalScore: number;
  totalPutts: number;
  onePutts: number;
  threePutts: number;
  upAndDowns: number;
  fairwaysHit: number;
  greensInRegulation: number;
  nearGreenCount: number;
  penalties: number;
  doublesOrWorse: number;
};

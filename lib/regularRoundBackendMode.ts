// The backend rounds table only allows non-tournament rounds as round_mode='solo'
// with tournament_id=null. Regular group behavior lives in round_participants
// and round_games, not rounds.round_mode.
export const BACKEND_REGULAR_GROUP_ROUND_MODE = 'solo';

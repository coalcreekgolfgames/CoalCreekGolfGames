type RoundWelcomeProfile = {
  first_name?: string | null;
  last_name?: string | null;
};

type RoundWelcomeUser = {
  email?: string | null;
  user_metadata?: {
    first_name?: string | null;
    last_name?: string | null;
    full_name?: string | null;
    name?: string | null;
    display_name?: string | null;
  } | null;
};

function firstWord(value: string | null | undefined) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return '';
  return trimmed.split(/\s+/)[0] ?? '';
}

export function getRoundWelcomeFirstName(params: {
  profile?: RoundWelcomeProfile | null;
  user?: RoundWelcomeUser | null;
}) {
  const { profile, user } = params;

  const profileFullName = `${profile?.first_name ?? ''} ${profile?.last_name ?? ''}`.trim();
  const metadata = user?.user_metadata ?? null;

  return firstWord(metadata?.display_name)
    || firstWord(metadata?.full_name)
    || firstWord(metadata?.name)
    || firstWord(profileFullName)
    || firstWord(profile?.first_name)
    || firstWord(metadata?.first_name)
    || firstWord(user?.email?.split('@')[0] ?? '')
    || 'Golfer';
}

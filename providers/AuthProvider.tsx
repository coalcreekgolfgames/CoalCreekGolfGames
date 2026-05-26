import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import * as Linking from 'expo-linking';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import {
  type GuestClaimCandidate,
  claimMyGuestProfile,
  dismissGuestClaimId,
  fetchGuestClaimCandidates,
  loadDismissedGuestClaimIds,
} from '@/lib/guestClaims';

const AUTH_BOOTSTRAP_TIMEOUT_MS = 10_000;
const SESSION_REFRESH_THRESHOLD_MS = 60_000;
const FALLBACK_REFRESH_INTERVAL_MS = 30 * 60_000;
const MIN_REFRESH_DELAY_MS = 30_000;
const RETRY_REFRESH_INTERVAL_MS = 5 * 60_000;

type Profile = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  is_admin?: boolean;
  handicap?: number | null;
};

type AuthContextValue = {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  authError: string | null;
  passwordRecoveryMode: boolean;
  authRefreshKey: number;
  pendingGuestClaims: GuestClaimCandidate[];
  retryAuthBootstrap: () => Promise<void>;
  refreshGuestClaims: () => Promise<void>;
  dismissGuestClaimCandidate: (guestProfileId: string) => Promise<void>;
  claimGuestClaimCandidate: (guestProfileId: string, associatePastRounds: boolean) => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (input: { firstName: string; lastName: string; email: string; password: string }) => Promise<void>;
  sendPasswordReset: (email: string) => Promise<void>;
  updatePassword: (password: string) => Promise<void>;
  completePasswordRecovery: () => void;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

async function fetchProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, first_name, last_name, email, is_admin, handicap')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

function logAuthDebug(event: string, payload: Record<string, unknown>) {
  if (!__DEV__) return;
  console.debug(`[auth] ${event}`, payload);
}

function getErrorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : typeof error === 'string'
      ? error
      : String((error as any)?.message ?? error ?? '');
}

function createTimeoutError(label: string) {
  return new Error(`${label} timed out after ${AUTH_BOOTSTRAP_TIMEOUT_MS}ms`);
}

async function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(createTimeoutError(label)), AUTH_BOOTSTRAP_TIMEOUT_MS);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function shouldRefreshSession(session: Session) {
  if (!session.expires_at) return false;
  return (session.expires_at * 1000) - Date.now() <= SESSION_REFRESH_THRESHOLD_MS;
}

function isExpectedStaleAuthError(error: unknown): boolean {
  const message = getErrorMessage(error);

  return (
    message.includes('Invalid Refresh Token') ||
    message.includes('Refresh Token Not Found') ||
    message.includes('Already Used') ||
    message.includes('JWT expired') ||
    message.includes('Auth session missing')
  );
}

function isRecoverableNetworkAuthError(error: unknown): boolean {
  const message = getErrorMessage(error).toLowerCase();
  return (
    message.includes('timed out') ||
    message.includes('timeout') ||
    message.includes('network request failed') ||
    message.includes('failed to fetch') ||
    message.includes('fetch failed') ||
    message.includes('network error') ||
    message.includes('socket') ||
    message.includes('offline') ||
    message.includes('unreachable') ||
    message.includes('connection') ||
    message.includes('temporarily unavailable') ||
    message.includes('unable to resolve host')
  );
}

const RESET_PASSWORD_REDIRECT_URL = 'coalcreekyardagebookexpo://reset-password';

function getResetPasswordRedirectUrl() {
  return RESET_PASSWORD_REDIRECT_URL;
}

function parseAuthCallbackUrl(url: string) {
  const [base, hash = ''] = url.split('#');
  const queryString = base.includes('?') ? base.slice(base.indexOf('?') + 1) : '';
  const params = new URLSearchParams(queryString);
  const hashParams = new URLSearchParams(hash);
  const accessToken = hashParams.get('access_token') ?? params.get('access_token');
  const refreshToken = hashParams.get('refresh_token') ?? params.get('refresh_token');
  const type = hashParams.get('type') ?? params.get('type');
  return {
    accessToken,
    refreshToken,
    type,
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [pendingGuestClaims, setPendingGuestClaims] = useState<GuestClaimCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [passwordRecoveryMode, setPasswordRecoveryMode] = useState(false);
  const [authRefreshKey, setAuthRefreshKey] = useState(0);
  const mountedRef = useRef(true);
  const bootstrapRunIdRef = useRef(0);
  const userIdRef = useRef<string | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const profileRef = useRef<Profile | null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshInFlightRef = useRef(false);
  const recoveryHandledRef = useRef<string | null>(null);

  const applyAuthState = useCallback((nextSession: Session | null, nextProfile: Profile | null) => {
    if (!mountedRef.current) return;
    sessionRef.current = nextSession;
    profileRef.current = nextProfile;
    setSession(nextSession);
    setUser(nextSession?.user ?? null);
    setProfile(nextProfile);
    if (!nextSession?.user?.id) {
      setPendingGuestClaims([]);
    }
    setAuthRefreshKey((current) => current + 1);
  }, []);

  const clearRefreshTimer = useCallback(() => {
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }
  }, []);

  const clearBadLocalAuthState = useCallback(async (reason: string, error?: unknown) => {
    const expectedStaleError = isExpectedStaleAuthError(error ?? reason);
    if (expectedStaleError) {
      logAuthDebug('clear_stale_local_auth_state', {
        reason,
        error: error instanceof Error ? error.message : typeof error === 'string' ? error : null,
      });
    } else {
      logAuthDebug('clear_bad_local_auth_state', { reason });
    }

    try {
      await supabase.auth.signOut({ scope: 'local' });
    } catch (error) {
      if (isExpectedStaleAuthError(error)) {
        logAuthDebug('local_sign_out_stale_token', {
          reason,
          error: error instanceof Error ? error.message : String(error),
        });
        return;
      }

      logAuthDebug('local_sign_out_failed', {
        reason,
        error: error instanceof Error ? error.message : String(error),
      });

      try {
        await supabase.auth.signOut();
      } catch (fallbackError) {
        if (isExpectedStaleAuthError(fallbackError)) {
          logAuthDebug('fallback_sign_out_stale_token', {
            reason,
            error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
          });
          return;
        }

        throw fallbackError;
      }
    }
  }, []);

  const applySignedOutState = useCallback((reason: string, nextAuthError: string | null) => {
    if (!mountedRef.current) return;
    logAuthDebug('apply_signed_out_state', { reason, nextAuthError });
    clearRefreshTimer();
    applyAuthState(null, null);
    setPendingGuestClaims([]);
    setAuthError(nextAuthError);
  }, [applyAuthState, clearRefreshTimer]);

  const applyRecoverableOfflineState = useCallback((params: {
    reason: string;
    session: Session;
    profile?: Profile | null;
    source: string;
    error: unknown;
  }) => {
    if (!mountedRef.current) return;
    const fallbackProfile = params.profile === undefined ? profileRef.current : params.profile;
    applyAuthState(params.session, fallbackProfile ?? null);
    setAuthError('You’re offline. Scores are saved on this device and we’ll reconnect automatically.');
    if (__DEV__) {
      console.debug('[offline-mode-debug]', {
        authState: params.reason,
        source: params.source,
        hasCachedSession: true,
        profileLoaded: !!(fallbackProfile ?? null),
        isNetworkError: isRecoverableNetworkAuthError(params.error),
        renderingAppShell: true,
        error: getErrorMessage(params.error),
      });
    }
  }, [applyAuthState]);

  const scheduleSessionRefresh = useCallback((nextSession: Session, reason: string, delayOverrideMs?: number) => {
    clearRefreshTimer();

    const refreshDelayMs = delayOverrideMs ?? (
      nextSession.expires_at
        ? Math.max((nextSession.expires_at * 1000) - Date.now() - SESSION_REFRESH_THRESHOLD_MS, MIN_REFRESH_DELAY_MS)
        : FALLBACK_REFRESH_INTERVAL_MS
    );

    logAuthDebug('schedule_session_refresh', {
      reason,
      userId: nextSession.user.id,
      refreshDelayMs,
      expiresAt: nextSession.expires_at ?? null,
    });

    refreshTimerRef.current = setTimeout(() => {
      refreshTimerRef.current = null;
      if (!mountedRef.current) return;
      void refreshSessionInBackground('timer');
    }, refreshDelayMs);
  }, [clearRefreshTimer]);

  const refreshSessionInBackground = useCallback(async (reason: 'timer' | 'app_active' | 'manual_retry') => {
    const currentSession = sessionRef.current;
    if (!currentSession?.user?.id) {
      clearRefreshTimer();
      return;
    }

    if (refreshInFlightRef.current) {
      logAuthDebug('skip_refresh_in_flight', { reason, userId: currentSession.user.id });
      return;
    }

    refreshInFlightRef.current = true;
    const runId = ++bootstrapRunIdRef.current;

    try {
      logAuthDebug('background_refresh_start', {
        reason,
        userId: currentSession.user.id,
        expiresAt: currentSession.expires_at ?? null,
      });

      const refreshResult = await withTimeout(supabase.auth.refreshSession(), 'auth.refreshSession');

      if (!mountedRef.current || runId !== bootstrapRunIdRef.current) return;

      if (refreshResult.error || !refreshResult.data.session) {
        const refreshError = refreshResult.error ?? new Error('missing refreshed session');

        if (isExpectedStaleAuthError(refreshError)) {
          await clearBadLocalAuthState('expected_stale_background_refresh_token', refreshError);
          if (!mountedRef.current || runId !== bootstrapRunIdRef.current) return;
          applySignedOutState('expected_stale_background_refresh_token', null);
          return;
        }

        setAuthError('We could not refresh your session. We will retry when the network is available.');
        logAuthDebug('background_refresh_failed', {
          reason,
          userId: currentSession.user.id,
          error: refreshError instanceof Error ? refreshError.message : String(refreshError),
        });
        scheduleSessionRefresh(currentSession, 'refresh_retry', RETRY_REFRESH_INTERVAL_MS);
        return;
      }

      const refreshedSession = refreshResult.data.session;
      applyAuthState(refreshedSession, profileRef.current);
      setAuthError(null);
      scheduleSessionRefresh(refreshedSession, 'refresh_success');
      logAuthDebug('background_refresh_complete', {
        reason,
        userId: refreshedSession.user.id,
        expiresAt: refreshedSession.expires_at ?? null,
      });
    } catch (error) {
      if (!mountedRef.current || runId !== bootstrapRunIdRef.current) return;

      if (isExpectedStaleAuthError(error)) {
        await clearBadLocalAuthState('expected_stale_background_refresh_throw', error);
        if (!mountedRef.current || runId !== bootstrapRunIdRef.current) return;
        applySignedOutState('expected_stale_background_refresh_throw', null);
        return;
      }

      setAuthError('We could not refresh your session. We will retry when the network is available.');
      logAuthDebug('background_refresh_throw', {
        reason,
        userId: currentSession.user.id,
        error: error instanceof Error ? error.message : String(error),
      });
      scheduleSessionRefresh(currentSession, 'refresh_retry_throw', RETRY_REFRESH_INTERVAL_MS);
    } finally {
      refreshInFlightRef.current = false;
    }
  }, [applyAuthState, applySignedOutState, clearBadLocalAuthState, clearRefreshTimer, scheduleSessionRefresh]);

  const hydrateAuthState = useCallback(async (
    source: 'startup' | 'manual_retry' | 'app_active' | 'auth_event',
    options?: {
      sessionOverride?: Session | null;
      showSpinner?: boolean;
      forceRefresh?: boolean;
    },
  ) => {
    const runId = ++bootstrapRunIdRef.current;
    const showSpinner = options?.showSpinner ?? false;
    const existingSession = sessionRef.current;
    let sessionToUse = options?.sessionOverride;

    if (showSpinner && mountedRef.current) {
      setLoading(true);
    }

    try {
      if (sessionToUse === undefined) {
        const sessionResult = await withTimeout(supabase.auth.getSession(), 'auth.getSession');
        sessionToUse = sessionResult.data.session;
      }

      if (!mountedRef.current || runId !== bootstrapRunIdRef.current) return;

      let nextSession = sessionToUse ?? null;

      if (nextSession && (options?.forceRefresh || shouldRefreshSession(nextSession))) {
        logAuthDebug('refresh_session_start', {
          source,
          userId: nextSession.user.id,
          expiresAt: nextSession.expires_at ?? null,
        });

        const refreshResult = await withTimeout(supabase.auth.refreshSession(), 'auth.refreshSession');

        if (!mountedRef.current || runId !== bootstrapRunIdRef.current) return;

        if (refreshResult.error || !refreshResult.data.session) {
          const refreshError = refreshResult.error ?? new Error('missing refreshed session');

          if (isExpectedStaleAuthError(refreshError)) {
            await clearBadLocalAuthState('expected_stale_refresh_token', refreshError);
            if (!mountedRef.current || runId !== bootstrapRunIdRef.current) return;
            applySignedOutState('expected_stale_refresh_token', null);
            return;
          }

          logAuthDebug('refresh_session_failed', {
            source,
            userId: nextSession.user.id,
            error: refreshResult.error?.message ?? 'missing refreshed session',
          });
          setAuthError('We could not refresh your session. We will retry when the network is available.');
        }

        nextSession = refreshResult.data.session ?? nextSession;
      }

      if (!nextSession?.user?.id) {
        applyAuthState(null, null);
        setAuthError(null);
        logAuthDebug('hydrate_complete', {
          source,
          sessionUserId: null,
          profileUserId: null,
        });
        return;
      }

      try {
        const nextProfile = await withTimeout(fetchProfile(nextSession.user.id), 'profile hydrate');
        if (!mountedRef.current || runId !== bootstrapRunIdRef.current) return;
        applyAuthState(nextSession, nextProfile);
        setAuthError(null);
        logAuthDebug('hydrate_complete', {
          source,
          sessionUserId: nextSession.user.id,
          profileUserId: nextProfile?.id ?? null,
        });
      } catch (error) {
        if (!mountedRef.current || runId !== bootstrapRunIdRef.current) return;
        const cachedProfile = profileRef.current?.id === nextSession.user.id ? profileRef.current : null;
        applyAuthState(nextSession, cachedProfile);
        setAuthError('We restored your session, but your profile could not be loaded. Retry when the network is available.');
        logAuthDebug('profile_hydrate_failed', {
          source,
          userId: nextSession.user.id,
          error: getErrorMessage(error),
          usedCachedProfile: !!cachedProfile,
        });
      }
    } catch (error) {
      if (!mountedRef.current || runId !== bootstrapRunIdRef.current) return;

      if (isExpectedStaleAuthError(error)) {
        await clearBadLocalAuthState('expected_stale_bootstrap_token', error);
        if (!mountedRef.current || runId !== bootstrapRunIdRef.current) return;
        applySignedOutState('expected_stale_bootstrap_token', null);
        return;
      }

      const fallbackSession = sessionToUse ?? existingSession;
      if (fallbackSession?.user?.id && isRecoverableNetworkAuthError(error)) {
        applyRecoverableOfflineState({
          reason: 'hydrate_network_failure',
          session: fallbackSession,
          source,
          error,
        });
        return;
      }

      applySignedOutState('hydrate_failed', 'We could not restore your saved session. Please retry or log in again.');
      logAuthDebug('hydrate_failed', {
        source,
        error: getErrorMessage(error),
      });
    } finally {
      if (mountedRef.current && runId === bootstrapRunIdRef.current) {
        setLoading(false);
      }
    }
  }, [applyAuthState, applyRecoverableOfflineState, applySignedOutState, clearBadLocalAuthState]);

  const retryAuthBootstrap = useCallback(async () => {
    if (sessionRef.current?.user?.id) {
      await refreshSessionInBackground('manual_retry');
      return;
    }

    await hydrateAuthState('manual_retry', { showSpinner: true, forceRefresh: true });
  }, [hydrateAuthState, refreshSessionInBackground]);

  const completePasswordRecovery = useCallback(() => {
    setPasswordRecoveryMode(false);
  }, []);

  const refreshGuestClaims = useCallback(async () => {
    if (!user?.id || !profile?.first_name || !profile?.last_name) {
      setPendingGuestClaims([]);
      return;
    }

    try {
      const [candidates, dismissedIds] = await Promise.all([
        fetchGuestClaimCandidates(profile.first_name, profile.last_name),
        loadDismissedGuestClaimIds(user.id),
      ]);

      setPendingGuestClaims(
        candidates.filter((candidate) => !dismissedIds.includes(candidate.guest_profile_id)),
      );
    } catch (error) {
      console.error('guest claim fetch failed', error);
      setPendingGuestClaims([]);
    }
  }, [user?.id, profile?.first_name, profile?.last_name]);

  useEffect(() => {
    userIdRef.current = user?.id ?? null;
  }, [user?.id]);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    profileRef.current = profile;
  }, [profile]);

  useEffect(() => {
    mountedRef.current = true;
    void hydrateAuthState('startup', { showSpinner: true });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!mountedRef.current) return;
      if (_event === 'INITIAL_SESSION') {
        logAuthDebug('skip_initial_session_event', {
          nextSessionUserId: nextSession?.user?.id ?? null,
        });
        return;
      }
      logAuthDebug('state_change', {
        event: _event,
        nextSessionUserId: nextSession?.user?.id ?? null,
      });

      if (_event === 'SIGNED_OUT') {
        setPasswordRecoveryMode(false);
        applySignedOutState('signed_out_event', null);
        return;
      }

      if (_event === 'PASSWORD_RECOVERY') {
        setPasswordRecoveryMode(true);
      }

      if (_event === 'TOKEN_REFRESHED' && nextSession?.user?.id) {
        applyAuthState(nextSession, profileRef.current);
        setAuthError(null);
        return;
      }

      void hydrateAuthState('auth_event', {
        sessionOverride: nextSession,
        forceRefresh: false,
      });
    });

    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        const activeSession = sessionRef.current;
        logAuthDebug('app_active_refresh_check', {
          userId: userIdRef.current,
          expiresAt: activeSession?.expires_at ?? null,
        });

        if (activeSession?.user?.id) {
          if (shouldRefreshSession(activeSession)) {
            void refreshSessionInBackground('app_active');
          } else {
            scheduleSessionRefresh(activeSession, 'app_active_reschedule');
          }
          return;
        }

        void hydrateAuthState('app_active', {
          showSpinner: false,
          forceRefresh: false,
        });
      }
    });

    return () => {
      mountedRef.current = false;
      clearRefreshTimer();
      sub.subscription.unsubscribe();
      appStateSub.remove();
    };
  }, [applyAuthState, applySignedOutState, clearRefreshTimer, hydrateAuthState, refreshSessionInBackground, scheduleSessionRefresh]);

  useEffect(() => {
    let active = true;

    const handleIncomingUrl = async (url: string | null) => {
      if (!active || !url) return;
      const parsed = parseAuthCallbackUrl(url);
      if (parsed.type !== 'recovery' || !parsed.accessToken || !parsed.refreshToken) return;
      if (recoveryHandledRef.current === url) return;
      recoveryHandledRef.current = url;

      try {
        const { error } = await supabase.auth.setSession({
          access_token: parsed.accessToken,
          refresh_token: parsed.refreshToken,
        });
        if (error) throw error;
        if (!active || !mountedRef.current) return;
        setPasswordRecoveryMode(true);
      } catch (error) {
        if (!active || !mountedRef.current) return;
        logAuthDebug('password_recovery_link_failed', {
          error: error instanceof Error ? error.message : String(error),
        });
        setAuthError('We could not open the password reset link. Please request a new one.');
      }
    };

    void Linking.getInitialURL().then((url) => {
      void handleIncomingUrl(url);
    });

    const sub = Linking.addEventListener('url', ({ url }) => {
      void handleIncomingUrl(url);
    });

    return () => {
      active = false;
      sub.remove();
    };
  }, []);

  useEffect(() => {
    if (!session?.user?.id) {
      clearRefreshTimer();
      return;
    }

    scheduleSessionRefresh(session, 'session_effect');

    return () => {
      clearRefreshTimer();
    };
  }, [clearRefreshTimer, scheduleSessionRefresh, session]);

  useEffect(() => {
    if (!loading) {
      refreshGuestClaims();
    }
  }, [loading, refreshGuestClaims]);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }, []);

  const signUp = useCallback(async (input: { firstName: string; lastName: string; email: string; password: string }) => {
    const { error } = await supabase.auth.signUp({
      email: input.email,
      password: input.password,
      options: {
        data: {
          first_name: input.firstName,
          last_name: input.lastName,
        },
      },
    });
    if (error) throw error;
  }, []);

  const sendPasswordReset = useCallback(async (email: string) => {
    const redirectTo = getResetPasswordRedirectUrl();
    if (__DEV__) {
      console.log('[password-reset-debug]', { redirectTo });
    }
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo,
    });
    if (error) throw error;
  }, []);

  const updatePassword = useCallback(async (password: string) => {
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw error;
  }, []);

  const dismissGuestClaimCandidate = useCallback(async (guestProfileId: string) => {
    if (!user?.id) return;
    await dismissGuestClaimId(user.id, guestProfileId);
    setPendingGuestClaims((current) =>
      current.filter((candidate) => candidate.guest_profile_id !== guestProfileId),
    );
  }, [user?.id]);

  const claimGuestClaimCandidate = useCallback(async (guestProfileId: string, associatePastRounds: boolean) => {
    await claimMyGuestProfile(guestProfileId, associatePastRounds);
    if (user?.id) {
      await dismissGuestClaimId(user.id, guestProfileId);
    }
    setPendingGuestClaims((current) =>
      current.filter((candidate) => candidate.guest_profile_id !== guestProfileId),
    );
  }, [user?.id]);

  const signOut = useCallback(async () => {
    try {
      const { error } = await supabase.auth.signOut();
      if (error) {
        if (isExpectedStaleAuthError(error)) {
          await clearBadLocalAuthState('expected_stale_sign_out_token', error);
          applySignedOutState('expected_stale_sign_out_token', null);
          return;
        }

        throw error;
      }
    } catch (error) {
      if (isExpectedStaleAuthError(error)) {
        await clearBadLocalAuthState('expected_stale_sign_out_throw', error);
        applySignedOutState('expected_stale_sign_out_throw', null);
        return;
      }

      throw error;
    }
  }, [applySignedOutState, clearBadLocalAuthState]);

  const value = useMemo(
    () => ({
      session,
      user,
      profile,
      loading,
      authError,
      passwordRecoveryMode,
      authRefreshKey,
      pendingGuestClaims,
      retryAuthBootstrap,
      refreshGuestClaims,
      dismissGuestClaimCandidate,
      claimGuestClaimCandidate,
      signIn,
      signUp,
      sendPasswordReset,
      updatePassword,
      completePasswordRecovery,
      signOut,
    }),
    [
      session,
      user,
      profile,
      loading,
      authError,
      passwordRecoveryMode,
      authRefreshKey,
      pendingGuestClaims,
      retryAuthBootstrap,
      refreshGuestClaims,
      dismissGuestClaimCandidate,
      claimGuestClaimCandidate,
      signIn,
      signUp,
      sendPasswordReset,
      updatePassword,
      completePasswordRecovery,
      signOut,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}

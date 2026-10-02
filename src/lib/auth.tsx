import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import type { Candidate } from './types';

type Role = 'admin' | 'candidate' | 'none';

interface AuthState {
  loading: boolean;
  session: Session | null;
  role: Role | null;
  candidate: Candidate | null;
  setCandidate: (c: Candidate) => void;
  refreshCandidate: () => Promise<Candidate | null>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [loading, setLoading] = useState(true);

  const resolveRole = useCallback(async (s: Session | null) => {
    if (!s) {
      setRole(null);
      setCandidate(null);
      return;
    }
    const uid = s.user.id;
    const { data: adminRow } = await supabase.from('admins').select('user_id').eq('user_id', uid).maybeSingle();
    if (adminRow) {
      setRole('admin');
      setCandidate(null);
      return;
    }
    const { data: cand } = await supabase.from('candidates').select('*').eq('id', uid).maybeSingle();
    if (cand) {
      setRole('candidate');
      setCandidate(cand as Candidate);
    } else {
      setRole('none');
      setCandidate(null);
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      await resolveRole(data.session);
      if (mounted) setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      // Token refreshes don't change who the user is; only re-resolve on sign-in/out.
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED') {
        setLoading(true);
        // Defer the query out of the auth callback (supabase-js recommendation).
        setTimeout(() => resolveRole(s).finally(() => setLoading(false)), 0);
      }
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [resolveRole]);

  const refreshCandidate = useCallback(async () => {
    if (!session) return null;
    const { data } = await supabase.from('candidates').select('*').eq('id', session.user.id).maybeSingle();
    if (data) setCandidate(data as Candidate);
    return (data as Candidate) ?? null;
  }, [session]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  return (
    <AuthContext.Provider value={{ loading, session, role, candidate, setCandidate, refreshCandidate, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { Alert, Button, FullPageSpinner, ThemeToggle, inputClass } from '../components/ui';
import LoginBackdrop from '../components/LoginBackdrop';

export default function LoginPage() {
  const { loading, session } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (loading) return <FullPageSpinner />;
  if (session) return <Navigate to="/" replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password: password.trim() });
    setBusy(false);
    if (error) {
      // Only map genuine credential failures; config problems (e.g. "Invalid API key") must stay visible.
      setError(/invalid login credentials/i.test(error.message)
        ? 'Incorrect email or password. Use the email address you applied with and the password sent by the recruiter.'
        : `Sign-in failed: ${error.message}`);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center p-6">
      <LoginBackdrop />
      <ThemeToggle onDark className="absolute right-4 top-4" />
      <div className="relative w-full max-w-md">
        <div className="login-rise mb-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-600 text-2xl text-white shadow-lg shadow-indigo-500/40 ring-1 ring-white/20">📊</div>
          <h1 className="text-xl font-bold text-white [text-shadow:0_1px_8px_rgba(0,0,0,0.3)]">WellnessTrack Tech Assessment</h1>
          <p className="mt-1 text-sm text-white/90 [text-shadow:0_1px_6px_rgba(0,0,0,0.3)]">HPB CDOO · Data Engineering Internship</p>
          <p className="mt-3 font-mono text-xs text-white [font-variant-ligatures:none]" aria-hidden="true">
            <span className="text-white/70">$</span> authenticate --candidate<span className="login-cursor ml-0.5 inline-block h-3 w-1.5 translate-y-0.5 bg-white" />
          </p>
        </div>
        <form onSubmit={submit} style={{ animationDelay: '0.15s' }}
          className="login-rise space-y-4 rounded-xl border border-white/20 bg-surface/95 p-6 shadow-2xl shadow-fuchsia-950/30 backdrop-blur">
          <div>
            <label htmlFor="email" className="mb-1 block text-sm font-medium">Email</label>
            <input id="email" type="email" autoComplete="username" required value={email}
              onChange={(e) => setEmail(e.target.value)} className={inputClass} placeholder="you@example.com" />
          </div>
          <div>
            <label htmlFor="password" className="mb-1 block text-sm font-medium">Access password</label>
            <input id="password" type="password" autoComplete="current-password" required value={password}
              onChange={(e) => setPassword(e.target.value)} className={inputClass} placeholder="xxxx-xxxx-xxxx" />
          </div>
          {error && <Alert>{error}</Alert>}
          <Button type="submit" disabled={busy} className="w-full">{busy ? 'Signing in…' : 'Sign in'}</Button>
          <p className="text-center text-xs text-slate-500">
            Your password is issued by the recruiter. Contact them if you have not received it or it has expired.
          </p>
        </form>
      </div>
    </div>
  );
}

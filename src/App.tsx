import { lazy, Suspense } from 'react';
import { HashRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/auth';
import { supabaseConfigured } from './lib/supabase';
import { isExpired } from './lib/format';
import { Alert, Button, FullPageSpinner } from './components/ui';
import LoginPage from './pages/LoginPage';
import WelcomePage from './pages/candidate/WelcomePage';
import SubmittedPage from './pages/candidate/SubmittedPage';

const AssessmentPage = lazy(() => import('./pages/candidate/AssessmentPage'));
const CandidatesPage = lazy(() => import('./pages/admin/CandidatesPage'));
const ReviewPage = lazy(() => import('./pages/admin/ReviewPage'));

export default function App() {
  if (!supabaseConfigured) {
    return (
      <div className="mx-auto max-w-xl p-8">
        <Alert>
          The portal is not configured. Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code>
          {' '}(see README) and rebuild.
        </Alert>
      </div>
    );
  }
  return (
    <HashRouter>
      <AuthProvider>
        <Suspense fallback={<FullPageSpinner />}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/" element={<HomeRedirect />} />
            <Route element={<RequireCandidate />}>
              <Route path="/welcome" element={<WelcomePage />} />
              <Route path="/assessment" element={<AssessmentPage />} />
              <Route path="/assessment/:qid" element={<AssessmentPage />} />
              <Route path="/submitted" element={<SubmittedPage />} />
            </Route>
            <Route element={<RequireAdmin />}>
              <Route path="/admin" element={<CandidatesPage />} />
              <Route path="/admin/candidates/:candidateId" element={<ReviewPage />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </AuthProvider>
    </HashRouter>
  );
}

function HomeRedirect() {
  const { loading, session, role } = useAuth();
  if (loading) return <FullPageSpinner />;
  if (!session) return <Navigate to="/login" replace />;
  if (role === 'admin') return <Navigate to="/admin" replace />;
  if (role === 'candidate') return <Navigate to="/welcome" replace />;
  if (role === 'error') return <RoleLookupFailed />;
  return <NoAccess message="This account is not registered for the assessment." />;
}

function RequireCandidate() {
  const { loading, session, role, candidate } = useAuth();
  const location = useLocation();
  if (loading) return <FullPageSpinner />;
  if (!session) return <Navigate to="/login" replace />;
  if (role === 'admin') return <Navigate to="/admin" replace />;
  if (role === 'error') return <RoleLookupFailed />;
  if (role !== 'candidate' || !candidate) return <NoAccess message="This account is not registered for the assessment." />;
  if (candidate.status === 'submitted') {
    return location.pathname === '/submitted' ? <Outlet /> : <Navigate to="/submitted" replace />;
  }
  if (!candidate.is_active) return <NoAccess message="Your access to this assessment has been disabled. Please contact the recruiter." />;
  if (isExpired(candidate.access_expires_at)) {
    return <NoAccess message="Your access window for this assessment has expired. Please contact the recruiter if you need more time." />;
  }
  return <Outlet />;
}

function RequireAdmin() {
  const { loading, session, role } = useAuth();
  if (loading) return <FullPageSpinner />;
  if (!session) return <Navigate to="/login" replace />;
  if (role !== 'admin') return <Navigate to="/" replace />;
  return <Outlet />;
}

/** The account lookup failed (network/outage); the account itself may be fine, so offer a retry. */
function RoleLookupFailed() {
  const { retryRole, signOut } = useAuth();
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-md space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-lg font-semibold">Could not verify your account</h1>
        <p className="text-sm text-slate-600">We couldn't reach the server. Check your connection and try again. Your answers are not affected.</p>
        <div className="flex gap-2">
          <Button onClick={retryRole}>Try again</Button>
          <Button variant="secondary" onClick={() => signOut()}>Sign out</Button>
        </div>
      </div>
    </div>
  );
}

function NoAccess({ message }: { message: string }) {
  const { signOut } = useAuth();
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-md space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-lg font-semibold">Access unavailable</h1>
        <p className="text-sm text-slate-600">{message}</p>
        <Button variant="secondary" onClick={() => signOut()}>Sign out</Button>
      </div>
    </div>
  );
}

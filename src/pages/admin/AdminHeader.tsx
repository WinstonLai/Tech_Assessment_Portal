import { Link } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { Button } from '../../components/ui';

export default function AdminHeader() {
  const { session, signOut } = useAuth();
  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white">
      <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-4 px-4">
        <Link to="/admin" className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-900 text-white">📊</span>
          <span className="text-sm font-bold">Assessment Admin</span>
        </Link>
        <nav className="text-sm"><Link to="/admin" className="text-slate-600 hover:text-slate-900">Candidates</Link></nav>
        <div className="ml-auto flex items-center gap-3 text-sm text-slate-600">
          <span className="hidden sm:inline">{session?.user.email}</span>
          <Button variant="ghost" onClick={() => signOut()}>Sign out</Button>
        </div>
      </div>
    </header>
  );
}

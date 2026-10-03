import type { ReactNode } from 'react';
import { ThemeToggle } from './ui';

export default function CandidateHeader({ right }: { right?: ReactNode }) {
  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-surface/95 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-4 px-4">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-white">📊</span>
          <div className="leading-tight">
            <div className="text-sm font-bold">WellnessTrack Tech Assessment</div>
            <div className="text-xs text-slate-500">HPB CDOO · Data Engineering Internship</div>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-3">{right}<ThemeToggle /></div>
      </div>
    </header>
  );
}

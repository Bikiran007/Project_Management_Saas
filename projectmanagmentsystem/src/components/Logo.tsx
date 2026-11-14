import clsx from 'clsx';

export function Logo({ light, compact }: { light?: boolean; compact?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <svg viewBox="0 0 32 32" className="h-8 w-8 shrink-0">
        <rect width="32" height="32" rx="8" fill={light ? '#fff' : '#2550eb'} />
        <path d="M9 10h14v3h-5.5v10h-3V13H9z" fill={light ? '#2550eb' : '#fff'} />
      </svg>
      {!compact && <span className={clsx('text-lg font-bold tracking-tight', light ? 'text-white' : 'text-slate-900')}>TaskForge</span>}
    </div>
  );
}

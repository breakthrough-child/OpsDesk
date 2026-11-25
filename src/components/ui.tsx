import Link from 'next/link';
import type { ReactNode } from 'react';

const TONES: Record<string, string> = {
  new: 'bg-sky-100 text-sky-800', processing: 'bg-sky-100 text-sky-800', handled: 'bg-emerald-100 text-emerald-800',
  awaiting_approval: 'bg-amber-100 text-amber-900', escalated: 'bg-red-100 text-red-800', failed: 'bg-red-100 text-red-800',
  pending: 'bg-amber-100 text-amber-900', approved: 'bg-emerald-100 text-emerald-800', rejected: 'bg-stone-200 text-stone-700',
  ok: 'bg-emerald-100 text-emerald-800', error: 'bg-red-100 text-red-800', denied: 'bg-red-100 text-red-800',
  live: 'bg-emerald-100 text-emerald-800', mock: 'bg-stone-200 text-stone-700',
};

export function Badge({ value, label }: { value: string; label?: string }) {
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${TONES[value] ?? 'bg-stone-100 text-stone-700'}`}>{(label ?? value).replace(/_/g, ' ')}</span>;
}

const NAV = [['/', 'Inbox'], ['/approvals', 'Approvals'], ['/evals', 'Evals'], ['/audit', 'Audit'], ['/integrations', 'Integrations'], ['/feedback', 'Feedback']] as const;

export function Nav({ session, demo }: { session: boolean; demo: boolean }) {
  return (
    <header className="border-b border-stone-200 bg-white">
      <div className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-stone-900 text-sm text-amber-200">O</span> OpsDesk
        </Link>
        <nav className="flex flex-1 gap-1 overflow-x-auto text-sm">
          {NAV.map(([href, label]) => <Link key={href} href={href} className="rounded-md px-2.5 py-1.5 text-stone-600 hover:bg-stone-100 hover:text-stone-900">{label}</Link>)}
        </nav>
        {demo && <span className="hidden rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-900 sm:inline">public demo · read-only</span>}
        {session ? (
          <form action="/api/logout" method="post"><button className="btn btn-ghost">Sign out</button></form>
        ) : (
          <Link href="/login" className="btn btn-ghost">Admin sign in</Link>
        )}
      </div>
    </header>
  );
}

export function PageTitle({ title, sub, right }: { title: string; sub?: string; right?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div><h1 className="text-xl font-semibold tracking-tight">{title}</h1>{sub && <p className="mt-0.5 text-sm text-stone-500">{sub}</p>}</div>
      {right}
    </div>
  );
}

export const money = (n: number) => `$${n.toFixed(n < 0.01 && n > 0 ? 5 : 4)}`;
export const ms = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(2)}s` : `${Math.round(n)}ms`);
export const when = (d: string | Date) => new Date(d).toISOString().replace('T', ' ').slice(0, 19) + 'Z';

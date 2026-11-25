'use client';
import { useEffect, useState } from 'react';

type Mode = 'light' | 'dark' | 'system';
const KEY = 'opsdesk-theme';

function apply(mode: Mode) {
  const dark = mode === 'dark' || (mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
}

/** Light / System / Dark switch. The choice is kept in localStorage; an inline script in <head> applies it before first paint. */
export function ThemeToggle() {
  const [mode, setMode] = useState<Mode>('system');

  useEffect(() => {
    let saved: Mode = 'system';
    try { const v = localStorage.getItem(KEY); if (v === 'light' || v === 'dark' || v === 'system') saved = v; } catch { /* storage blocked */ }
    setMode(saved);
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => { if ((localStorage.getItem(KEY) ?? 'system') === 'system') apply('system'); };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  function choose(m: Mode) {
    setMode(m);
    try { localStorage.setItem(KEY, m); } catch { /* ignore */ }
    apply(m);
  }

  const opts: Array<[Mode, string, string]> = [['light', '☀', 'Light theme'], ['system', '◐', 'System theme'], ['dark', '☾', 'Dark theme']];
  return (
    <div role="radiogroup" aria-label="Theme" className="flex overflow-hidden rounded-lg border border-stone-300">
      {opts.map(([m, icon, label]) => (
        <button key={m} type="button" role="radio" aria-checked={mode === m} aria-label={label} title={label} onClick={() => choose(m)}
          className={`px-2 py-1 text-sm leading-none transition ${mode === m ? 'bg-stone-900 text-white' : 'bg-white text-stone-600 hover:bg-stone-50'}`}>{icon}</button>
      ))}
    </div>
  );
}

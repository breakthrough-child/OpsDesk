'use client';
import { useState } from 'react';

const REASONS = [['wrong_answer', 'Wrong answer'], ['missing_info', 'Missing information'], ['bad_tone', 'Bad tone'], ['unsafe', 'Unsafe'], ['should_have_escalated', 'Should have escalated'], ['unnecessary_escalation', 'Unnecessary escalation'], ['other', 'Other']] as const;

export function FeedbackControl({ target, traceId, messageId, approvalId }: { target: 'reply' | 'approval'; traceId?: string | null; messageId?: string; approvalId?: string }) {
  const [rating, setRating] = useState<'up' | 'down' | null>(null);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [consent, setConsent] = useState(false);
  const [state, setState] = useState<'idle' | 'sent' | 'error'>('idle');

  async function send(r: 'up' | 'down') {
    setRating(r);
    if (r === 'up' && !consent) return;
  }
  async function submit() {
    const res = await fetch('/api/feedback', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ target, rating, reason: reason || undefined, note: note || undefined, traceId: traceId ?? undefined, messageId, approvalId, consent }) });
    setState(res.ok ? 'sent' : 'error');
  }
  if (state === 'sent') return <p className="text-xs text-emerald-700">Thanks, feedback recorded.</p>;
  return (
    <div className="space-y-2 text-sm">
      <div className="flex items-center gap-2">
        <span className="text-xs text-stone-500">Was this {target === 'reply' ? 'reply' : 'decision'} good?</span>
        <button aria-label="thumbs up" onClick={() => send('up')} className={`btn btn-ghost ${rating === 'up' ? 'ring-2 ring-emerald-400' : ''}`}>👍</button>
        <button aria-label="thumbs down" onClick={() => send('down')} className={`btn btn-ghost ${rating === 'down' ? 'ring-2 ring-red-400' : ''}`}>👎</button>
      </div>
      {rating && (
        <div className="space-y-2 rounded-lg border border-stone-200 bg-stone-50 p-3">
          {rating === 'down' && <select value={reason} onChange={(e) => setReason(e.target.value)} className="w-full rounded-md border border-stone-300 bg-white px-2 py-1.5 text-sm"><option value="">Reason…</option>{REASONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>}
          <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} rows={2} placeholder="Optional comment (no real personal data)" className="w-full rounded-md border border-stone-300 px-2 py-1.5 text-sm" />
          <label className="flex items-start gap-2 text-xs text-stone-600"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5" />I agree my rating and comment are stored with this trace to improve the system. I have not entered real personal data.</label>
          <button disabled={!consent} onClick={submit} className="btn btn-primary">Send feedback</button>
          {state === 'error' && <span className="text-xs text-red-700">Could not save feedback.</span>}
        </div>
      )}
    </div>
  );
}

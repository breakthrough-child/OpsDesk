'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function ApprovalActions({ id, args, canAct }: { id: string; args: Record<string, unknown>; canAct: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(JSON.stringify(args, null, 2));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  async function decide(decision: 'approve' | 'reject', edited?: Record<string, unknown>) {
    setBusy(true); setMsg('');
    const res = await fetch(`/api/approvals/${id}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ decision, editedArgs: edited }) });
    const j = await res.json();
    setBusy(false);
    if (!res.ok) return setMsg(j.error ?? 'Failed');
    router.refresh();
  }
  function saveEdit() {
    try { void decide('approve', JSON.parse(text)); } catch { setMsg('Edited arguments are not valid JSON'); }
  }

  if (!canAct) return <p className="text-xs text-stone-500">Read-only. <a className="underline" href="/login">Sign in as admin</a> to approve, edit or reject.</p>;
  return (
    <div className="space-y-2">
      {editing && <textarea value={text} onChange={(e) => setText(e.target.value)} rows={Math.min(12, text.split('\n').length + 1)} className="w-full rounded-md border border-stone-300 p-2 font-mono text-xs" />}
      <div className="flex flex-wrap gap-2">
        {editing ? <button disabled={busy} onClick={saveEdit} className="btn btn-primary">Approve edited</button> : <button disabled={busy} onClick={() => decide('approve')} className="btn btn-primary">Approve</button>}
        <button disabled={busy} onClick={() => setEditing(!editing)} className="btn btn-ghost">{editing ? 'Cancel edit' : 'Edit'}</button>
        <button disabled={busy} onClick={() => decide('reject')} className="btn btn-danger">Reject</button>
        {msg && <span className="self-center text-sm text-red-700">{msg}</span>}
      </div>
    </div>
  );
}

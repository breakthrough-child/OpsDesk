import { NextResponse } from 'next/server';
import { z } from 'zod';
import { decideApproval } from '@/lib/agent/approvals';
import { requireAdmin } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { McpToolClient } from '../../../../../mcp-server/client';

export const dynamic = 'force-dynamic';

const Body = z.object({ decision: z.enum(['approve', 'reject']), editedArgs: z.record(z.unknown()).optional() });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin.ok) return NextResponse.json({ error: 'Sign in as admin to decide approvals.' }, { status: 401 });
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  const db = await getDb();
  const mcp = await McpToolClient.connectInMemory(db);
  try {
    const r = await decideApproval(db, (await params).id, { decision: p.data.decision, by: admin.sub, editedArgs: p.data.editedArgs, mcp });
    return NextResponse.json({ status: r.approval.status, executed: r.executed, alreadyDecided: r.alreadyDecided, result: r.approval.result });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'failed' }, { status: 404 });
  } finally {
    await mcp.close();
  }
}

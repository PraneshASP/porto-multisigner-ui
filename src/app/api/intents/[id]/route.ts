import { NextResponse } from 'next/server';
import { getIntent } from '../../_lib/store';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const intent = getIntent(id);
  
  if (!intent) {
    return NextResponse.json({ error: 'Intent not found' }, { status: 404 });
  }
  
  // Convert BigInt values to strings for JSON serialization
  const intentForJson = {
    ...intent,
    seqKey: intent.seqKey.toString(),
    nonce: intent.nonce.toString(),
    calls: intent.calls.map(call => ({
      ...call,
      value: call.value.toString()
    }))
  };
  
  return NextResponse.json(intentForJson);
}
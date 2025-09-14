import { NextResponse } from 'next/server';
import { getAllIntents } from '../../_lib/store';

export async function GET() {
  try {
    const db = getAllIntents();
    // Convert BigInt values to strings for JSON serialization
    const intentsForJson = Object.fromEntries(
      [...db.entries()].map(([key, intent]) => [
        key,
        {
          ...intent,
          seqKey: intent.seqKey.toString(),
          nonce: intent.nonce.toString(),
          calls: intent.calls.map(call => ({
            ...call,
            value: call.value.toString()
          }))
        }
      ])
    );
    
    return NextResponse.json({
      count: db.size,
      keys: [...db.keys()],
      intents: intentsForJson
    });
  } catch (error) {
    console.error('Debug endpoint error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
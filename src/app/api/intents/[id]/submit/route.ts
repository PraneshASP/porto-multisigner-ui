import { NextResponse } from 'next/server';
import { Hex, concatHex, encodeAbiParameters, toHex } from 'viem';
import { getIntent, setIntent } from '../../../_lib/store';
import { publicClient, walletClient, MODE_SINGLE_WITH_OPDATA } from '../../../_lib/viem';
import { accountAbi } from '@/lib/abi/account';

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const intent = getIntent(id);
  if (!intent) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!walletClient) return NextResponse.json({ error: 'RELAYER_PRIVATE_KEY missing' }, { status: 500 });

  // Ensure we still meet threshold (in case config changed)
  if (intent.signatures.length < intent.threshold) {
    return NextResponse.json({ error: 'Not enough signatures' }, { status: 400 });
  }

  // 1) aggregated = abi.encode(bytes[] ownerSigs)
  const ownerSigs = intent.signatures.map((s) => s.sig);
  const aggregated = encodeAbiParameters([{ type: 'bytes[]' }], [ownerSigs]);

  // 2) outer = abi.encodePacked(aggregated, bytes32(externalKeyHash), false /*prehash*/ )
  const outer = concatHex([aggregated, intent.externalKeyHash as Hex, '0x00']);

  // 3) opData = abi.encodePacked(uint256 nonce, bytes signature)
  const opData = concatHex([toHex(intent.nonce, { size: 32 }), outer]);

  // 4) executionData = abi.encode(Call[], opData)
  const executionData = encodeAbiParameters(
    [
      {
        type: 'tuple[]',
        components: [
          { name: 'to', type: 'address' },
          { name: 'value', type: 'uint256' },
          { name: 'data', type: 'bytes' },
        ],
      },
      { type: 'bytes' },
    ],
    [intent.calls, opData],
  );

  // 5) Check current nonce vs intent nonce
  const currentNonce = await publicClient.readContract({
    address: intent.account,
    abi: accountAbi,
    functionName: 'getNonce',
    args: [0n], // seqKey 0 for default sequence
  });

  if (BigInt(intent.nonce) !== currentNonce) {
    return NextResponse.json({ 
      error: 'Nonce mismatch', 
      intentNonce: intent.nonce.toString(),
      currentNonce: currentNonce.toString(),
      hint: 'The intent nonce is outdated. Create a new intent with the current nonce.'
    }, { status: 400 });
  }

  // 6) call account.execute(mode, executionData)
  try {
    const hash = await walletClient.writeContract({
      address: intent.account,
      abi: accountAbi,
      functionName: 'execute',
      args: [MODE_SINGLE_WITH_OPDATA, executionData],
      // value can stay 0; if your calls require ETH, pass via wallet or include value in calls
    });

    setIntent(intent.id, { status: 'submitted', txHash: hash });
    // (Optional) wait for confirmation
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    setIntent(intent.id, { status: receipt.status === 'success' ? 'confirmed' : 'failed' });

    return NextResponse.json({ ok: true, txHash: hash, status: receipt.status });
  } catch (e: any) {
    setIntent(intent.id, { status: 'failed' });
    return NextResponse.json({ error: e?.message ?? 'submit failed' }, { status: 500 });
  }
}
/**
 * Intent Signing API Route
 * 
 * Handles signature validation and collection for multisig intents.
 * This endpoint validates Porto WebAuthn signatures and adds them to the intent's signature collection.
 * 
 * Flow:
 * 1. Validates the wrapped signature against the account contract
 * 2. Attempts signature validation with both prehash values (0x00 and 0x01)
 * 3. Verifies the signer is authorized in the intent's owner set
 * 4. Prevents duplicate signatures from the same owner
 * 5. Stores valid signatures and returns collection status
 */
import { NextResponse } from 'next/server';
import { Hex } from 'viem';
import { getIntent, setIntent } from '../../../_lib/store';
import { publicClient } from '../../../_lib/viem';
import { accountAbi } from '@/lib/abi/account';
import { abi as multiSigAbi } from '@/../abis/MultisigSignerAbi.json';

/**
 * Validates a wrapped Porto signature against an account contract
 * 
 * Porto signatures may have different prehash values, so this function
 * attempts validation with both 0x00 and 0x01 prehash bytes.
 * 
 * @param account The account address to validate against
 * @param digest The digest that was signed
 * @param wrapped The wrapped signature from Porto
 * @returns Object with validation result and owner key hash
 */
async function validateWrappedSignature(account: Hex, digest: Hex, wrapped: Hex) {
  
  const tryOnce = async (sig: Hex, _label: string) => {
    try {
      const [ok, ownerKh] = (await publicClient.readContract({
        address: account,
        abi: accountAbi,
        functionName: 'unwrapAndValidateSignature',
        args: [digest, sig],
      })) as [boolean, Hex];
      return { ok, ownerKh, sig };
    } catch (e) {
      return { ok: false as const, ownerKh: '0x' as Hex, sig };
    }
  };

  let res = await tryOnce(wrapped, 'original signature');
  if (res.ok) return res;

  const hex = wrapped.toLowerCase();
  if (!hex.startsWith('0x') || hex.length < 2 + 64 + 64 + 64 + 2) {
    return res; // malformed length; return first attempt
  }
  const last2 = hex.slice(-2);
  const flippedLast2 = last2 === '01' ? '00' : '01';
  const flipped = (hex.slice(0, -2) + flippedLast2) as Hex;

  const res2 = await tryOnce(flipped, 'flipped prehash signature');
  if (res2.ok) return res2;

  return res;
}

/**
 * POST /api/intents/[id]/sign
 * 
 * Validates and collects signatures for a multisig intent
 * 
 * @param req Request containing { wrappedSignature: Hex }
 * @param params Route parameters containing intent ID
 * @returns Signature validation result and collection status
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const intent = getIntent(id);
  if (!intent) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = await req.json();
  const { wrappedSignature } = body as { wrappedSignature: Hex };
  if (!wrappedSignature) {
    return NextResponse.json({ error: 'Missing wrappedSignature' }, { status: 400 });
  }

  try {
    const accountAddr = intent.account as Hex;
    const calls = intent.calls;
    const nonce = intent.nonce;

    if (Array.isArray(calls) && nonce !== undefined && nonce !== null) {
      const onChainDigest = (await publicClient.readContract({
        address: accountAddr,
        abi: accountAbi,
        functionName: 'computeDigest',
        args: [calls, BigInt(nonce)],
      })) as Hex;

      const matches = onChainDigest.toLowerCase() === (intent.digest as Hex).toLowerCase();

      if (!matches) {
        return NextResponse.json({ error: 'Digest mismatch' }, { status: 400 });
      }
    }
  } catch (e) {
    console.warn('computeDigest check failed:', e);
  }

  const account = intent.account as Hex;
  const digest = intent.digest as Hex;


  const checked = await validateWrappedSignature(account, digest, wrappedSignature);

  if (!checked.ok) {
    return NextResponse.json(
      {
        error: 'Invalid signature',
      },
      { status: 400 },
    );
  }

  const ownerKeyHash = checked.ownerKh;

  if (!intent.owners.some((k: string) => k.toLowerCase() === ownerKeyHash.toLowerCase())) {
    return NextResponse.json({ error: 'Signer not authorized' }, { status: 400 });
  }

  if (intent.signatures.some((s: any) => s.ownerKeyHash.toLowerCase() === ownerKeyHash.toLowerCase())) {
    return NextResponse.json({ ok: true, k: intent.signatures.length, M: intent.threshold });
  }

  intent.signatures.push({ ownerKeyHash, sig: checked.sig, at: Date.now() });
  setIntent(intent.id, { signatures: intent.signatures });

  return NextResponse.json({
    ok: true,
    k: intent.signatures.length,
    M: intent.threshold,
    ready: intent.signatures.length >= intent.threshold,
  });
}
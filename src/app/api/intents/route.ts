/**
 * Intent Creation API Route
 * 
 * Creates new multisig intents for transaction execution.
 * Fetches multisig configuration, computes transaction digest, and stores the intent.
 * 
 * Flow:
 * 1. Validates multisig configuration exists for the given account and external key
 * 2. Retrieves current nonce from the account contract
 * 3. Computes the digest that signers will sign
 * 4. Stores the intent with all necessary metadata for signature collection
 */
import { NextResponse } from 'next/server';
import { Hex, encodeFunctionData } from 'viem';
import { publicClient } from '../_lib/viem';
import { accountAbi } from '../../../lib/abi/account';
import { abi as multiSigAbi } from '@/../abis/MultisigSignerAbi.json';
import { upsertIntent } from '../_lib/store';
import { randomUUID } from 'crypto';

/**
 * POST /api/intents
 * 
 * Creates a new multisig intent for transaction execution
 * 
 * @param req Request containing intent parameters
 * @returns Created intent with ID and digest
 */
export async function POST(req: Request) {
  const body = await req.json();
  const {
    account,            // 0xAccount (Porto)
    chainId,            // 84532
    externalKeyHash,    // bytes32 (multisig policy key)
    seqKey = '0',       // string uint192 (default 0)
    calls,              // [{to, value, data}]
    multisigAddress,    // 0xMultiSigSigner
  } = body as {
    account: Hex; chainId: number; externalKeyHash: Hex; seqKey?: string;
    calls: { to: Hex; value: string | number; data: Hex }[];
    multisigAddress: Hex;
  };

  // 1) Fetch config (threshold + owners) to store alongside the intent
  
  const [threshold, ownerKeyHashes] = (await publicClient.readContract({
    address: multisigAddress,
    abi: multiSigAbi as any,
    functionName: 'getConfig',
    args: [account, externalKeyHash],
  })) as [bigint, Hex[]];


  if (!ownerKeyHashes?.length) {
    return NextResponse.json({ error: 'No owners configured for this keyHash' }, { status: 400 });
  }

  // 2) Get nonce for sequence key (uint192)
  const seqKeyBig = BigInt(seqKey);
  const nonce = (await publicClient.readContract({
    address: account,
    abi: accountAbi,
    functionName: 'getNonce',
    args: [seqKeyBig],
  })) as bigint;

  // 3) Compute digest (account.computeDigest(calls, nonce))
  // viem encodes tuple[] automatically from {to,value,data}
  const digest = (await publicClient.readContract({
    address: account,
    abi: accountAbi,
    functionName: 'computeDigest',
    args: [calls.map(c => ({ ...c, value: BigInt(c.value) })), nonce],
  })) as Hex;

  const intent = upsertIntent({
    id: randomUUID(),
    account,
    chainId,
    externalKeyHash,
    seqKey: seqKeyBig,
    nonce,
    digest,
    calls: calls.map(c => ({ ...c, value: BigInt(c.value) })),
    threshold: Number(threshold),
    owners: ownerKeyHashes,
    signatures: [],
    status: 'collecting',
  });

  return NextResponse.json({ id: intent.id, digest: intent.digest, threshold: intent.threshold, owners: intent.owners });
}
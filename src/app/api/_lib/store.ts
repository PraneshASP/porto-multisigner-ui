import type { Hex } from 'viem';

export type Call = { to: Hex; value: bigint | number | string; data: Hex };
export type Intent = {
  id: string;
  account: Hex;
  chainId: number;
  externalKeyHash: Hex;        // the multisig policy keyHash
  seqKey: bigint;              // uint192
  nonce: bigint;               // full uint256 nonce
  digest: Hex;                 // bytes32
  calls: Call[];
  threshold: number;
  owners: Hex[];               // owner keyHashes from on-chain config
  signatures: { ownerKeyHash: Hex; sig: Hex; at: number }[];
  status: 'collecting' | 'submitted' | 'confirmed' | 'failed';
  txHash?: Hex;
};

// Use global to persist across module reloads in development
const globalForDB = globalThis as unknown as {
  intentDB: Map<string, Intent> | undefined;
};

const DB = globalForDB.intentDB ?? new Map<string, Intent>();
if (!globalForDB.intentDB) {
  globalForDB.intentDB = DB;
}
export const upsertIntent = (i: Intent) => {
  DB.set(i.id, i);
  return i;
};
export const getIntent = (id: string) => {
  return DB.get(id);
};
export const setIntent = (id: string, patch: Partial<Intent>) => {
  const now = DB.get(id);
  if (!now) return;
  DB.set(id, { ...now, ...patch });
};
export const getAllIntents = () => DB;
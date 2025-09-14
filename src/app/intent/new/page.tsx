'use client';
import { useState } from 'react';
import { Hex } from 'viem';

const MULTISIG_ADDRESS = process.env.NEXT_PUBLIC_MULTISIG_SIGNER as Hex;

export default function NewIntent() {
  const [account, setAccount] = useState<Hex>('0x');
  const [externalKeyHash, setExternalKeyHash] = useState<Hex>('0x');
  const [to, setTo] = useState<Hex>('0x');
  const [amount, setAmount] = useState('0'); // wei
  const [digest, setDigest] = useState<Hex>();
  const [intentId, setIntentId] = useState<string>();

  async function create() {
    if (!MULTISIG_ADDRESS) {
      alert('NEXT_PUBLIC_MULTISIG_SIGNER not configured');
      return;
    }
    
    const calls = [{ to, value: amount, data: '0x' as Hex }];
    try {
      const response = await fetch('/api/intents', {
        method: 'POST',
        body: JSON.stringify({
          account,
          chainId: 84532,
          externalKeyHash,
          seqKey: '0',
          calls,
          multisigAddress: MULTISIG_ADDRESS,
        }),
        headers: { 'content-type': 'application/json' },
      });
      
      if (!response.ok) {
        const text = await response.text();
        console.error('API Error:', response.status, text);
        alert(`API Error ${response.status}: ${text}`);
        return;
      }
      
      const res = await response.json();
      if (res.id) {
        setIntentId(res.id);
        setDigest(res.digest);
      } else {
        alert(res.error || 'failed');
      }
    } catch (error) {
      console.error('Request failed:', error);
      alert(`Request failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  return (
    <main className="max-w-xl mx-auto p-6 text-white font-mono">
      <h1 className="text-xl mb-4">New Intent</h1>

      <label className="block text-sm">Account</label>
      <input className="w-full bg-black border border-gray-800 p-2 mb-3" value={account} onChange={(e) => setAccount(e.target.value as Hex)} />

      <label className="block text-sm">External Key Hash</label>
      <input className="w-full bg-black border border-gray-800 p-2 mb-3" value={externalKeyHash} onChange={(e) => setExternalKeyHash(e.target.value as Hex)} />

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-sm">To</label>
          <input className="w-full bg-black border border-gray-800 p-2 mb-3" value={to} onChange={(e) => setTo(e.target.value as Hex)} />
        </div>
        <div>
          <label className="block text-sm">Amount (wei)</label>
          <input className="w-full bg-black border border-gray-800 p-2 mb-3" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
      </div>

      <button onClick={create} className="px-4 py-2 bg-white text-black">Create</button>

      {intentId && (
        <div className="mt-6 space-y-2">
          <div>Intent ID: <code>{intentId}</code></div>
          <div>Digest: <code>{digest}</code></div>
          <div className="text-xs text-gray-400">Share link for signers:</div>
          <code className="text-xs break-all">{location.origin}/intent/{intentId}</code>
        </div>
      )}
    </main>
  );
}
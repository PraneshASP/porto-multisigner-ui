'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import type { Hex } from 'viem';
import { Key } from 'porto';

export default function IntentDetail() {
  const { id } = useParams<{ id: string }>();
  const [intent, setIntent] = useState<any>();
  const [status, setStatus] = useState<string>('collecting');
  const [busy, setBusy] = useState(false);

  // Use existing Porto key for signing
  const [portoKey, setPortoKey] = useState<any | null>(null);
  const [portoOwnerKeyHash, setPortoOwnerKeyHash] = useState<Hex | null>(null);

  // Load intent details from server (digest, owners, threshold, etc.)
  async function fetchIntent() {
    try {
      const res = await fetch(`/api/intents/${id}`);
      if (!res.ok) throw new Error(`GET /api/intents/${id} failed`);
      const data = await res.json();
      setIntent(data);
      setStatus(data.status || 'collecting');
    } catch {
      // As a last resort, keep a placeholder; but we will disable signing if digest is missing.
      setIntent((prev: any) => prev ?? { id, digest: undefined });
    }
  }



  async function sign() {
    if (!intent?.digest) {
      alert('Digest not loaded yet. Did you create this intent on /intent/new?');
      return;
    }

    setBusy(true);
    try {
      // Reconstruct the existing Porto key from stored credential data
      const savedCredential = localStorage.getItem('portoCredential');
      
      if (!savedCredential) {
        alert('No Porto credential found. Please create a passkey on the main page first.');
        return;
      }

      const credentialData = JSON.parse(savedCredential);
      
      
      // Reconstruct the Porto key using fromWebAuthnP256 with the original format
      const existingKey = Key.fromWebAuthnP256({
        credential: {
          id: credentialData.id,
          publicKey: {
            x: BigInt(credentialData.publicKey.x),
            y: BigInt(credentialData.publicKey.y),
            prefix: credentialData.publicKey.prefix
          }
        }
      });


      const wrapped = await Key.sign(existingKey, {
        address: null, // Sign raw digest for call bundle (not replay-safe ERC-1271)
        payload: intent.digest as Hex,
      });
      

      const res = await fetch(`/api/intents/${id}/sign`, {
        method: 'POST',
        body: JSON.stringify({ wrappedSignature: wrapped }),
        headers: { 'content-type': 'application/json' },
      }).then((r) => r.json());

      if (!res.ok) {
        alert(res.error || 'sign failed');
        return;
      }

      setStatus(res.ready ? 'ready' : `collected ${res.k}/${res.M}`);
    } catch (e: any) {
      console.error('Sign error:', e);
      alert(e?.message || 'Sign error');
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    setBusy(true);
    try {
      const res = await fetch(`/api/intents/${id}/submit`, { method: 'POST' }).then((r) => r.json());
      if (res.ok) {
        setStatus(res.status || 'submitted');
      } else {
        alert(res.error || 'submit failed');
      }
    } finally {
      setBusy(false);
    }
  }

  // Load existing Porto passkey on mount
  useEffect(() => {
    const loadExistingPasskey = async () => {
      try {
        // Check if we have a passkey from the main page
        const savedOwnerKeyHash = localStorage.getItem('ownerKeyHash');
        const savedCredential = localStorage.getItem('portoCredential');
        
        if (savedOwnerKeyHash && savedCredential) {
          // We have a passkey - create a minimal object for UI display
          setPortoKey({ id: savedOwnerKeyHash });
          setPortoOwnerKeyHash(savedOwnerKeyHash as Hex);
        } else {
        }
      } catch (error) {
        console.error('Failed to load existing passkey:', error);
      }
    };
    
    fetchIntent();
    loadExistingPasskey();
  }, [id]);

  const digestKnown = Boolean(intent?.digest);

  return (
    <main className="max-w-xl mx-auto p-6 text-white font-mono">
      <h1 className="text-xl mb-2">Intent {id}</h1>

      <div className="text-xs text-gray-400 mb-4">
        {digestKnown ? (
          <>Digest: <code>{intent.digest}</code></>
        ) : (
          <span className="text-yellow-500">Digest not loaded. Ensure you created this intent on /intent/new and that /api/intents/[id] GET is implemented.</span>
        )}
      </div>

      <div className="mb-4">
        <h2 className="font-bold mb-2">Sign with Porto Passkey</h2>
        <div className="p-3 border border-gray-800 space-y-3">
          {portoOwnerKeyHash ? (
            <div className="space-y-2">
              <div className="text-green-500 text-sm">✓ Porto passkey ready to sign</div>
              <div className="text-xs text-gray-400">
                Owner Key Hash: <code className="break-all">{portoOwnerKeyHash}</code>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="text-yellow-500 text-sm">No Porto passkey found</div>
              <div className="text-xs text-gray-500">
                Please go to the main page and create a Porto passkey first.
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="flex gap-2">
        <button
          className="px-4 py-2 bg-blue-600 text-white disabled:opacity-50 hover:bg-blue-700"
          disabled={busy || !digestKnown}
          onClick={sign}
        >
          {busy ? 'Signing...' : 'Sign Intent'}
        </button>
        <button
          className="px-4 py-2 bg-white text-black disabled:opacity-50 hover:bg-gray-200"
          disabled={busy}
          onClick={submit}
        >
          Submit
        </button>
      </div>

      <div className="mt-4 text-sm">
        Status:{' '}
        <span className={status.includes('ready') || status === 'confirmed' ? 'text-green-500' : 'text-yellow-500'}>
          {status}
        </span>
      </div>

      {!portoKey && (
        <p className="text-xs text-yellow-500 mt-4">
          Create a passkey above to sign this intent.
        </p>
      )}

      {!digestKnown && (
        <p className="text-xs text-yellow-500 mt-2">
          Intent digest not loaded. Ensure this intent was created properly.
        </p>
      )}
    </main>
  );
}

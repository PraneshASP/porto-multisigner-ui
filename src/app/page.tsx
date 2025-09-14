/**
 * Porto Multisig Main Interface
 * 
 * This component provides the complete multisig setup and management interface.
 * It handles three main flows:
 * 1. Setup: Configure external keys, passkeys, and multisig parameters
 * 2. Intent Creation: Create transaction intents for signing
 * 3. Intent Signing: Collect signatures from multiple passkeys
 * 
 * Key features:
 * - WebAuthn passkey creation and management
 * - External key authorization with batched permissions
 * - Multisig threshold configuration
 * - Intent creation with automatic digest computation
 * - Multi-passkey signature collection
 * - Transaction submission when threshold is met
 */
'use client';
import { useAccount, useReadContract, useSendCalls, useCallsStatus, useConnector } from 'wagmi';
import Connect from '@/components/Connect';
import { abi as multiSigAbi } from '../../abis/MultisigSignerAbi.json';
import { abi as  accountAbi } from '../../abis/IthacaAccount.json';
import { useMemo, useState, useEffect } from 'react';
import { encodeFunctionData, isHex, Hex, keccak256, encodeAbiParameters } from 'viem';
import { encodeAuthorizeExternalExecute } from '@/lib/externalKey';
import { encodeSetCanExecuteExecute, encodeSetSpendLimitExecute, ANY_TARGET, EMPTY_CALLDATA_FN_SEL } from '@/lib/permissions';
import { WebAuthnP256 } from 'ox';
import Link from 'next/link';

const MULTISIG_ADDRESS = process.env.NEXT_PUBLIC_MULTISIG_SIGNER as `0x${string}`;

/**
 * Computes owner key hash from WebAuthn public key coordinates
 * This matches the on-chain key hash computation in IthacaAccount
 * 
 * @param x The x coordinate of the WebAuthn public key
 * @param y The y coordinate of the WebAuthn public key
 * @returns The computed owner key hash
 */
function ownerKeyHashFromXY(x: bigint, y: bigint) {
  const pubEncoded = encodeAbiParameters([{type:'uint256'},{type:'uint256'}],[x,y]);
  const pubHash    = keccak256(pubEncoded);
  const packed     = encodeAbiParameters([{type:'uint8'},{type:'bytes32'}],[1, pubHash]); // 1 = WebAuthnP256
  return keccak256(packed) as `0x${string}`;
}

/**
 * Normalizes key hash to proper format (32 bytes = 64 hex chars + 0x prefix)
 * 
 * @param keyHash The key hash to normalize
 * @returns Properly formatted key hash
 */
function normalizeKeyHash(keyHash: string): string {
  if (!keyHash.startsWith('0x')) {
    keyHash = '0x' + keyHash;
  }
  const hexPart = keyHash.slice(2);
  if (hexPart.length < 64) {
    return '0x' + hexPart.padStart(64, '0');
  } else if (hexPart.length > 64) {
    return '0x' + hexPart.slice(0, 64);
  }
  return keyHash.toLowerCase();
}

/**
 * Extracts intent ID from URL or returns input as-is
 * Supports pasting full URLs or just intent IDs
 * 
 * @param input URL or intent ID string
 * @returns Extracted intent ID
 */
function extractIntentId(input: string): string {
  const urlMatch = input.match(/\/intent\/([^/?]+)/);
  return urlMatch ? urlMatch[1] : input.trim();
}

type Owner = { keyHash: `0x${string}`; label?: string };

export default function Home() {
  const { address, connector } = useAccount();
  
  // Local state replacing Zustand store
  const [externalKeyHash, setExternalKeyHash] = useState<`0x${string}` | ''>('');
  const [owners, setOwners] = useState<Owner[]>([]);
  const [threshold, setThreshold] = useState(1);
  
  const [newOwner, setNewOwner] = useState('');
  const [busy, setBusy] = useState(false);
  const [salt12, setSalt12] = useState<'0x' | `0x${string}`>('0x000000000000000000000000'); // 12-byte hex
  const [activeTab, setActiveTab] = useState<'setup' | 'create' | 'sign'>('setup');
  
  // Intent creation state
  const [intentAccount, setIntentAccount] = useState<Hex>(address || '0x');
  const [intentExternalKeyHash, setIntentExternalKeyHash] = useState<Hex>('0x');
  const [intentTo, setIntentTo] = useState<Hex>('0x');
  const [intentAmount, setIntentAmount] = useState('0');
  const [intentDigest, setIntentDigest] = useState<Hex>();
  const [intentId, setIntentId] = useState<string>();
  
  // Intent signing state
  const [signIntentId, setSignIntentId] = useState<string>('');
  const [loadedIntent, setLoadedIntent] = useState<any>();
  const [signStatus, setSignStatus] = useState<string>('collecting');
  const [externalKeyHashLocal, setExternalKeyHashLocal] = useState<`0x${string}` | ''>('');
  const [ownerKeyHash, setOwnerKeyHash] = useState<string>('');
  const [credentialId, setCredentialId] = useState<string>('');

  // Multiple passkeys storage
  const [allPasskeys, setAllPasskeys] = useState<Array<{
    id: string;
    ownerKeyHash: string;
    credentialData: any;
    label: string;
  }>>([]);

  // EIP-5792 call id we get back after sendCalls
  const [callId, setCallId] = useState<string | null>(null);

  // Helper functions to manage owners
  const addOwner = (owner: Owner) => {
    if (owners.some(o => o.keyHash === owner.keyHash)) return;
    const newOwners = [...owners, owner];
    setOwners(newOwners);
    localStorage.setItem('multisig-owners', JSON.stringify(newOwners));
  };

  const removeOwner = (keyHash: `0x${string}`) => {
    const newOwners = owners.filter(o => o.keyHash !== keyHash);
    setOwners(newOwners);
    localStorage.setItem('multisig-owners', JSON.stringify(newOwners));
  };

  // Load state from localStorage on mount
  useEffect(() => {
    const savedOwners = localStorage.getItem('multisig-owners');
    const savedThreshold = localStorage.getItem('multisig-threshold');
    const savedExternalKeyHash = localStorage.getItem('multisig-external-key-hash');
    const savedPasskeys = localStorage.getItem('multisig-passkeys');
    
    if (savedOwners) {
      try {
        setOwners(JSON.parse(savedOwners));
      } catch (e) {
        console.warn('Failed to parse saved owners');
      }
    }
    
    if (savedThreshold) {
      setThreshold(parseInt(savedThreshold, 10) || 1);
    }
    
    if (savedExternalKeyHash) {
      setExternalKeyHash(savedExternalKeyHash as `0x${string}`);
    }

    if (savedPasskeys) {
      try {
        setAllPasskeys(JSON.parse(savedPasskeys));
      } catch (e) {
        console.warn('Failed to parse saved passkeys');
      }
    }
  }, []);

  // Save threshold to localStorage when changed
  useEffect(() => {
    localStorage.setItem('multisig-threshold', threshold.toString());
  }, [threshold]);

  // Save externalKeyHash to localStorage when changed
  useEffect(() => {
    if (externalKeyHash) {
      localStorage.setItem('multisig-external-key-hash', externalKeyHash);
    }
  }, [externalKeyHash]);

  const { sendCalls, data: sendResult, isPending: sending } = useSendCalls();

  // Track call status once we have an id
  const { data: callsStatus, refetch: refetchCallsStatus } = useCallsStatus({
    id: callId ?? '',
    query: {
      enabled: !!callId,
      refetchInterval: (q) => {
        const status = q.state.data?.status;
        return status === 'CONFIRMED' || status === 'FAILED' ? false : 1500;
      },
    },
  });




  // Note: We'll rely on Porto Key APIs directly instead of contract calls
  const loadingKeys = false;

  // Read on-chain config for the *connected account* + provided keyHash
  const { data: readData, refetch } = useReadContract({
    address: MULTISIG_ADDRESS,
    abi: multiSigAbi,
    functionName: 'getConfig',
    args: address && externalKeyHash ? [address, externalKeyHash as `0x${string}`] : undefined,
  });

  // Detect if config exists (initialized)
  const configExists = useMemo(() => {
    const t = (readData as any)?.[0];
    const arr = (readData as any)?.[1];
    try {
      return (t !== undefined && BigInt(t) > 0n) || (Array.isArray(arr) && arr.length > 0);
    } catch {
      return Array.isArray(arr) && arr.length > 0;
    }
  }, [readData]);


  // Submit a batch (single-call batch for now) via EIP-5792
  const submitCalls = async (datas: `0x${string}`[]) => {
    setBusy(true);
    try {
      const id = await sendCalls({
        calls: datas.map((data) => ({ to: MULTISIG_ADDRESS, data })),
        // capabilities: { /* add paymaster/funding options here later */ }
      });
      // id can be string or object depending on wallet – normalize:
      const _id = typeof id === 'string' ? id : (id as any)?.id;
      setCallId(_id ?? null);
    } catch (e) {
      console.error(e);
    } finally {
      setBusy(false);
    }
  };

  /**
   * Authorizes a WebAuthn key on the connected IthacaAccount
   * This allows the key to directly interact with the account contract
   * 
   * @param x The x coordinate of the WebAuthn public key
   * @param y The y coordinate of the WebAuthn public key
   */
  const authorizeKeyOnAccount = async (x: bigint, y: bigint) => {
    if (!address) return;
    
    
    try {
      // Create Key struct: keyType=1 (WebAuthnP256), expiry=0, isSuperAdmin=false
      const publicKey = encodeAbiParameters(
        [{ type: 'uint256' }, { type: 'uint256' }],
        [x, y]
      );

      const key = {
        expiry: 0n,
        keyType: 1, // WebAuthnP256
        isSuperAdmin: false,
        publicKey,
      };

      // Create authorize call data (simple approach like other working buttons)
      const authorizeData = encodeFunctionData({
        abi: accountAbi,
        functionName: 'authorize',
        args: [key],
      });

      // Send the transaction directly (like other working authorize functions)
      const id = await sendCalls({
        calls: [{ to: address, data: authorizeData }]
      });

      const _id = typeof id === 'string' ? id : (id as any)?.id;
      setCallId(_id ?? null);
      
      
    } catch (error) {
      console.error('Failed to authorize key:', error);
      alert('Failed to authorize key');
    }
  };

  /**
   * Authorizes an existing passkey on the account using stored credentials
   * 
   * @param passkey The passkey object containing credential data
   */
  const authorizePasskeyOnAccount = async (passkey: any) => {
    const credentialData = {
      publicKey: {
        x: passkey.credentialData.publicKey.x,
        y: passkey.credentialData.publicKey.y
      }
    };
    await authorizeKeyOnAccount(BigInt(credentialData.publicKey.x), BigInt(credentialData.publicKey.y));
  };

  /**
   * Creates additional WebAuthn passkeys for multisig signers
   * Each passkey can independently sign transactions
   * 
   * @param label Optional label for the passkey
   * @returns The created passkey object or null on failure
   */
  const createAdditionalPasskey = async (label?: string) => {
    try {
      const { Key } = await import('porto');
      
      const passkeyLabel = label || `Signer ${allPasskeys.length + 1}`;
      const key = await Key.createWebAuthnP256({ label: passkeyLabel });
      
      const credentialId = key.privateKey?.credential?.id || key.id;
      const x = key.privateKey?.credential?.publicKey?.x;
      const y = key.privateKey?.credential?.publicKey?.y;
      
      let computedOwnerKeyHash = key.id;
      if (x && y) {
        computedOwnerKeyHash = ownerKeyHashFromXY(x, y);
      }
      
      const credentialData = {
        id: credentialId,
        publicKey: {
          prefix: key.privateKey?.credential?.publicKey?.prefix,
          x: x?.toString(),
          y: y?.toString()
        }
      };

      const newPasskey = {
        id: credentialId,
        ownerKeyHash: computedOwnerKeyHash,
        credentialData,
        label: passkeyLabel
      };

      const updatedPasskeys = [...allPasskeys, newPasskey];
      setAllPasskeys(updatedPasskeys);
      localStorage.setItem('multisig-passkeys', JSON.stringify(updatedPasskeys));
      
      // Auto-add to owners list
      addOwner({ keyHash: computedOwnerKeyHash as `0x${string}`, label: passkeyLabel });
      
      return newPasskey;
    } catch (error) {
      console.error('Failed to create additional passkey:', error);
      alert('Failed to create passkey. Please try again.');
      return null;
    }
  };

  /**
   * Creates the primary WebAuthn passkey and computes owner hash
   * This is the main passkey used for account operations
   */
  const createPasskeyOwnerHash = async () => {
    try {
      const { Key } = await import('porto');
      
      // Create Porto passkey
      const label = `Porto Account ${address?.slice(0, 6)}...${address?.slice(-4)}`;
      const key = await Key.createWebAuthnP256({ label });
      
      // Extract values using correct paths
      const credentialId = key.privateKey?.credential?.id || key.id;
      const x = key.privateKey?.credential?.publicKey?.x;
      const y = key.privateKey?.credential?.publicKey?.y;
      
      // Compute proper owner key hash if we have coordinates
      let computedOwnerKeyHash = key.id; // fallback
      if (x && y) {
        computedOwnerKeyHash = ownerKeyHashFromXY(x, y);
      }
      
      setCredentialId(credentialId);
      setOwnerKeyHash(computedOwnerKeyHash);
      
      const credentialData = {
        id: credentialId,
        publicKey: {
          prefix: key.privateKey?.credential?.publicKey?.prefix,
          x: x?.toString(),
          y: y?.toString()
        }
      };
      
      localStorage.setItem('portoCredential', JSON.stringify(credentialData));
      localStorage.setItem('ownerKeyHash', computedOwnerKeyHash);
      
      // Automatically authorize the key on the account
      if (x && y) {
        await authorizeKeyOnAccount(x, y);
      }
    } catch (error) {
      console.error('Failed to create Porto passkey:', error);
      alert('Failed to create Porto passkey. Please try again.');
    }
  };


  // Batched setup: Authorize external key + set permissions in one transaction
  const onSetupExternalKeyBatched = async () => {
    if (!address) return alert('Connect first');
    if (!MULTISIG_ADDRESS) return alert('Missing NEXT_PUBLIC_MULTISIG_SIGNER');
    if (!isHex(salt12) || (salt12 as string).length !== 2 + 24) return alert('Salt must be 12 bytes hex');

    setBusy(true);
    try {
      // 1. Prepare external key authorization
      const { to: authTo, data: authData, externalKeyHash: computedHash } = encodeAuthorizeExternalExecute({
        account: address as Hex,
        multisig: MULTISIG_ADDRESS,
        salt12: salt12 as Hex,
        accountAbi,
      });

      // 2. Prepare empty calls permission
      const { to: emptyTo, data: emptyData } = encodeSetCanExecuteExecute({
        account: address as Hex,
        keyHash: computedHash as Hex,
        target: ANY_TARGET,
        fnSel: EMPTY_CALLDATA_FN_SEL,
        can: true,
        accountAbi,
      });

      // 3. Prepare ETH spending permission
      const limitWei = 1_000_000_000_000_000_000n; // 1 ETH
      const { to: spendTo, data: spendData } = encodeSetSpendLimitExecute({
        account: address as Hex,
        keyHash: computedHash as Hex,
        token: '0x0000000000000000000000000000000000000000',
        period: 6, // Forever
        limit: limitWei,
        accountAbi,
      });

      // 4. Execute all three operations in a single batched transaction
      const id = await sendCalls({
        calls: [
          { to: authTo, data: authData },
          { to: emptyTo, data: emptyData },
          { to: spendTo, data: spendData }
        ]
      });

      const _id = typeof id === 'string' ? id : (id as any)?.id;
      setCallId(_id ?? null);
      
      // Update state after successful batch
      setExternalKeyHash(computedHash as `0x${string}`);
      setExternalKeyHashLocal(computedHash as `0x${string}`);
      
    } catch (e) {
      console.error('Batched setup failed:', e);
      alert('Batched setup failed. See console for details.');
    } finally {
      setBusy(false);
    }
  };

  // Complete multisig setup: Authorize passkey + initialize multisig in one transaction  
  const onCompleteMultisigSetup = async () => {
    if (!address) return alert('Connect wallet first');
    if (!externalKeyHash) return alert('Setup external key first');
    if (owners.length === 0) return alert('Add at least one owner');
    if (threshold < 1 || threshold > owners.length) return alert('Invalid threshold');
    
    // Check if we have passkey credentials
    const savedCredential = localStorage.getItem('portoCredential');
    if (!savedCredential) {
      alert('No Porto passkey found. Create a passkey first.');
      return;
    }

    setBusy(true);
    try {
      const credentialData = JSON.parse(savedCredential);
      const x = BigInt(credentialData.publicKey.x);
      const y = BigInt(credentialData.publicKey.y);

      // 1. Prepare passkey authorization call
      const publicKey = encodeAbiParameters(
        [{ type: 'uint256' }, { type: 'uint256' }],
        [x, y]
      );

      const key = {
        expiry: 0n,
        keyType: 1, // WebAuthnP256
        isSuperAdmin: false,
        publicKey,
      };

      const authorizeData = encodeFunctionData({
        abi: accountAbi,
        functionName: 'authorize',
        args: [key],
      });

      const mode = '0x0100000000000000000000000000000000000000000000000000000000000000' as Hex;
      const executionData = encodeAbiParameters(
        [{ type: 'tuple[]', components: [
          { name: 'to', type: 'address' },
          { name: 'value', type: 'uint256' },
          { name: 'data', type: 'bytes' },
        ]}],
        [[{ to: '0x0000000000000000000000000000000000000000', value: 0n, data: authorizeData }]]
      );

      // 2. Prepare multisig initialization call
      const initConfigData = encodeFunctionData({
        abi: multiSigAbi,
        functionName: 'initConfig',
        args: [
          externalKeyHash as `0x${string}`,
          BigInt(threshold),
          owners.map((o) => o.keyHash),
        ],
      });

      // 3. Execute both operations in a single batched transaction
      const id = await sendCalls({
        calls: [
          { 
            to: address, 
            data: encodeFunctionData({
              abi: accountAbi,
              functionName: 'execute',
              args: [mode, executionData]
            })
          },
          { to: MULTISIG_ADDRESS, data: initConfigData }
        ]
      });

      const _id = typeof id === 'string' ? id : (id as any)?.id;
      setCallId(_id ?? null);
      
      await refetch();
      
    } catch (error) {
      console.error('Complete multisig setup failed:', error);
      alert('Complete multisig setup failed. See console for details.');
    } finally {
      setBusy(false);
    }
  };


  /**
   * Creates a new multisig intent for transaction execution
   * Sends transaction details to the API to generate intent with digest
   */
  const createIntent = async () => {
    if (!MULTISIG_ADDRESS) {
      alert('NEXT_PUBLIC_MULTISIG_SIGNER not configured');
      return;
    }
    
    
    const calls = [{ to: intentTo, value: intentAmount, data: '0x' as Hex }];
    setBusy(true);
    try {
      const response = await fetch('/api/intents', {
        method: 'POST',
        body: JSON.stringify({
          account: intentAccount,
          chainId: 84532,
          externalKeyHash: intentExternalKeyHash,
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
        setIntentDigest(res.digest);
        setSignIntentId(res.id); // Auto-fill for signing tab
      } else {
        alert(res.error || 'failed');
      }
    } catch (error) {
      console.error('Request failed:', error);
      alert('Request failed');
    } finally {
      setBusy(false);
    }
  };

  /**
   * Loads an intent by ID for signature collection
   * 
   * @param id The intent ID to load
   */
  const loadIntent = async (id: string) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/intents/${id}`);
      if (!res.ok) throw new Error(`GET /api/intents/${id} failed`);
      const data = await res.json();
      setLoadedIntent(data);
      setSignStatus(data.status || 'collecting');
    } catch {
      setLoadedIntent({ id, digest: undefined });
    } finally {
      setBusy(false);
    }
  };

  /**
   * Signs an intent using a specific passkey
   * Reconstructs the Porto key and generates signature
   * 
   * @param passkey The passkey to use for signing
   */
  const signWithPasskey = async (passkey: any) => {
    if (!loadedIntent?.digest) {
      alert('Load intent first');
      return;
    }


    setBusy(true);
    try {
      const { Key } = await import('porto');
      
      const existingKey = Key.fromWebAuthnP256({
        credential: {
          id: passkey.credentialData.id,
          publicKey: {
            x: BigInt(passkey.credentialData.publicKey.x),
            y: BigInt(passkey.credentialData.publicKey.y),
            prefix: passkey.credentialData.publicKey.prefix
          }
        }
      });

      const wrapped = await Key.sign(existingKey, {
        address: null,
        payload: loadedIntent.digest as Hex,
      });

      const res = await fetch(`/api/intents/${signIntentId}/sign`, {
        method: 'POST',
        body: JSON.stringify({ wrappedSignature: wrapped }),
        headers: { 'content-type': 'application/json' },
      }).then((r) => r.json());

      if (!res.ok) {
        alert(res.error || 'sign failed');
        return;
      }

      setSignStatus(res.ready ? 'ready' : `collected ${res.k}/${res.M}`);
    } catch (e: any) {
      console.error('Sign error:', e);
      alert(e?.message || 'Sign error');
    } finally {
      setBusy(false);
    }
  };

  /**
   * Signs intent using the primary passkey (legacy function)
   * Uses stored credential from localStorage
   */
  const signIntent = async () => {
    if (!loadedIntent?.digest) {
      alert('Load intent first');
      return;
    }

    setBusy(true);
    try {
      const savedCredential = localStorage.getItem('portoCredential');
      
      if (!savedCredential) {
        alert('No Porto credential found. Please create a passkey first.');
        return;
      }

      const credentialData = JSON.parse(savedCredential);
      const { Key } = await import('porto');
      
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
        address: null,
        payload: loadedIntent.digest as Hex,
      });

      const res = await fetch(`/api/intents/${signIntentId}/sign`, {
        method: 'POST',
        body: JSON.stringify({ wrappedSignature: wrapped }),
        headers: { 'content-type': 'application/json' },
      }).then((r) => r.json());

      if (!res.ok) {
        alert(res.error || 'sign failed');
        return;
      }

      setSignStatus(res.ready ? 'ready' : `collected ${res.k}/${res.M}`);
    } catch (e: any) {
      console.error('Sign error:', e);
      alert(e?.message || 'Sign error');
    } finally {
      setBusy(false);
    }
  };

  /**
   * Submits a ready intent for execution
   * Only works when threshold signatures have been collected
   */
  const submitIntent = async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/intents/${signIntentId}/submit`, { method: 'POST' }).then((r) => r.json());
      if (res.ok) {
        setSignStatus(res.status || 'submitted');
      } else {
        alert(res.error || 'submit failed');
      }
    } finally {
      setBusy(false);
    }
  };


  // Check localStorage for existing passkeys
  useEffect(() => {
    const loadExistingPasskey = () => {
      const savedOwner = localStorage.getItem('ownerKeyHash');
      const savedCredential = localStorage.getItem('portoCredential');
      
      if (savedOwner && savedCredential) {
        try {
          const credentialData = JSON.parse(savedCredential);
          setOwnerKeyHash(savedOwner);
          setCredentialId(credentialData.id);
        } catch (e) {
          console.warn('Failed to parse saved credential');
        }
      }
    };
    
    loadExistingPasskey();
  }, []);


  // Sync intent form with current account and external key hash
  useEffect(() => {
    if (address) setIntentAccount(address);
  }, [address]);

  useEffect(() => {
    if (externalKeyHash) setIntentExternalKeyHash(externalKeyHash);
  }, [externalKeyHash]);

  // Auto-load intent when signIntentId changes
  useEffect(() => {
    if (signIntentId && signIntentId !== loadedIntent?.id) {
      loadIntent(signIntentId);
    }
  }, [signIntentId, loadedIntent?.id]);

  // Refresh on-chain reads when a batch confirms
  useEffect(() => {
    if (callsStatus?.status === 'CONFIRMED') {
      refetch();
    }
  }, [callsStatus?.status, refetch]);

  // Auto-compute external key hash when address or salt changes
  useEffect(() => {
    if (address && MULTISIG_ADDRESS && salt12 && salt12 !== '0x' && salt12.length === 26) {
      try {
        const { externalKeyHash: computedHash } = encodeAuthorizeExternalExecute({
          account: address as Hex,
          multisig: MULTISIG_ADDRESS,
          salt12: salt12 as Hex,
          accountAbi,
        });
        setExternalKeyHash(computedHash as `0x${string}`);
      } catch (error) {
        console.warn('Failed to compute external key hash:', error);
      }
    }
  }, [address, salt12]);

  return (
    <main className="min-h-screen bg-black text-white font-mono">
      <div className="max-w-3xl mx-auto p-6">
        {/* Header */}
        <div className="border border-gray-800 p-4 mb-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-xl font-bold">Porto Multisig</h1>
            </div>
            <div className="flex gap-2 items-center">
              <Connect />
            </div>
          </div>
          
          {/* Tab Navigation */}
          <div className="flex gap-0 border border-gray-800">
            <button
              className={`flex-1 py-2 px-4 text-sm font-medium ${activeTab === 'setup' ? 'bg-white text-black' : 'bg-gray-900 text-gray-300 hover:bg-gray-800'} border-r border-gray-800`}
              onClick={() => setActiveTab('setup')}
            >
              Setup
            </button>
            <button
              className={`flex-1 py-2 px-4 text-sm font-medium ${activeTab === 'create' ? 'bg-white text-black' : 'bg-gray-900 text-gray-300 hover:bg-gray-800'} border-r border-gray-800`}
              onClick={() => setActiveTab('create')}
            >
              Create Intent
            </button>
            <button
              className={`flex-1 py-2 px-4 text-sm font-medium ${activeTab === 'sign' ? 'bg-white text-black' : 'bg-gray-900 text-gray-300 hover:bg-gray-800'}`}
              onClick={() => setActiveTab('sign')}
            >
              Sign Intent
            </button>
          </div>
        </div>

        {/* Tab Content */}
        {activeTab === 'setup' && (
          <>


        {/* Configuration Interface */}
        <div className="space-y-4">
        {/* External Key Hash */}
        <div className="border border-gray-800 p-4 mb-4">
          <h2 className="font-bold mb-3">External Key Hash</h2>
          <div className="grid grid-cols-1 gap-2">
            <input
              className="w-full bg-black border border-gray-800 p-2 text-sm focus:border-gray-600 outline-none"
              placeholder="0x... (or auto-filled after Authorize)"
              value={externalKeyHash}
              onChange={(e) => setExternalKeyHash(e.target.value as `0x${string}`)}
            />
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <input
                  className="flex-1 bg-black border border-gray-800 p-2 text-sm"
                  value={salt12}
                  onChange={(e) => setSalt12(e.target.value as any)}
                  placeholder="Salt (bytes12) e.g. 0x000...000"
                />
                <button
                  className="px-4 py-2 bg-blue-600 text-white text-sm hover:bg-blue-700 disabled:opacity-50"
                  disabled={!address || sending || busy}
                  onClick={onSetupExternalKeyBatched}
                >
                  {busy ? 'Setting up...' : 'Setup External Key (Batched)'}
                </button>
              </div>
              
            </div>
            {externalKeyHashLocal && (
              <p className="text-xs text-gray-500">Computed keyHash: <code>{externalKeyHashLocal}</code></p>
            )}
          </div>
        </div>

        {/* Connected Account Info */}
        <div className="border border-gray-800 p-4 mb-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-bold">Connected Porto Account</h2>
            <div className="flex gap-2">
              {address && !ownerKeyHash && (
                <button
                  className="px-3 py-2 bg-blue-600 text-white text-xs hover:bg-blue-700 disabled:opacity-50"
                  disabled={busy}
                  onClick={createPasskeyOwnerHash}
                >
                  Get My Passkey
                </button>
              )}
              {address && ownerKeyHash && (
                <button
                  className="px-3 py-2 bg-green-600 text-white text-xs hover:bg-green-700 disabled:opacity-50"
                  disabled={busy}
                  onClick={async () => {
                    const savedCredential = localStorage.getItem('portoCredential');
                    if (savedCredential) {
                      const credentialData = JSON.parse(savedCredential);
                      await authorizeKeyOnAccount(BigInt(credentialData.publicKey.x), BigInt(credentialData.publicKey.y));
                    }
                  }}
                >
                  Authorize Key on Account
                </button>
              )}
            </div>
            {loadingKeys && (
              <span className="text-xs text-gray-500">Loading keys...</span>
            )}
          </div>
          
          {address ? (
            <div className="space-y-2 text-xs">
              <div className="flex items-center gap-2">
                <span className="text-gray-400 w-20">Address:</span>
                <code className="flex-1 font-mono">{address}</code>
              </div>
              
              {ownerKeyHash ? (
                <>
                  <div className="flex items-center gap-2">
                    <span className="text-gray-400 w-20">Owner Hash:</span>
                    <code className="flex-1 font-mono">{ownerKeyHash}</code>
                  </div>
                  {credentialId && (
                    <div className="flex items-center gap-2">
                      <span className="text-gray-400 w-20">Credential:</span>
                      <code className="flex-1 font-mono text-xs break-all">{credentialId}</code>
                    </div>
                  )}
                  <div className="text-gray-500">
                    ✓ Passkey ready
                  </div>
                </>
              ) : loadingKeys ? (
                <div className="text-gray-500">
                  Loading existing passkey data from Porto account...
                </div>
              ) : (
                <div className="text-gray-500">
                  No passkey found. Click "Get My Passkey" to create one.
                </div>
              )}
            </div>
          ) : (
            <div className="text-xs text-gray-500">
              Connect your Porto account to see account information.
            </div>
          )}
        </div>

        {/* Owners */}
        <div className="border border-gray-800 p-4 mb-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-bold">Owners ({owners.length})</h2>
            {ownerKeyHash && (
              <button
                className="px-3 py-2 border border-gray-800 text-xs hover:bg-gray-900"
                onClick={() => addOwner({ keyHash: ownerKeyHash as `0x${string}`, label: 'My Passkey' })}
                disabled={owners.some(o => o.keyHash === ownerKeyHash)}
              >
                {owners.some(o => o.keyHash === ownerKeyHash) ? 'Added' : 'Add My Passkey'}
              </button>
            )}
          </div>

          {/* Create Additional Passkey */}
          <div className="border border-blue-800 p-3 mb-3 bg-blue-900/10">
            <h3 className="font-bold text-sm mb-2 text-blue-400">Create Additional Signers</h3>
            <p className="text-xs text-gray-400 mb-3">
              Create additional passkeys for multisig signers:
            </p>
            <button
              className="w-full px-3 py-2 bg-blue-600 text-white text-xs font-bold hover:bg-blue-700 disabled:opacity-50"
              disabled={busy}
              onClick={() => createAdditionalPasskey()}
            >
              {busy ? 'Creating...' : 'Create New Passkey Signer'}
            </button>
          </div>

          {/* Manual Owner Addition */}
          <div className="flex gap-2 mb-3">
            <input
              className="flex-1 bg-black border border-gray-800 p-2 text-sm focus:border-gray-600 outline-none"
              placeholder="0x... (owner key hash)"
              value={newOwner}
              onChange={(e) => setNewOwner(e.target.value)}
            />
            <button
              className="px-3 py-2 border border-gray-800 text-xs hover:bg-gray-900 disabled:opacity-50"
              disabled={!isHex(newOwner) || newOwner.length !== 66}
              onClick={() => {
                if (isHex(newOwner) && newOwner.length === 66) {
                  addOwner({ keyHash: newOwner as `0x${string}`, label: 'Owner' });
                  setNewOwner('');
                }
              }}
            >
              Add Owner
            </button>
          </div>

          {/* All Created Passkeys */}
          {allPasskeys.length > 0 && (
            <div className="border border-green-800 p-3 mb-3 bg-green-900/10">
              <h4 className="font-bold text-sm mb-2 text-green-400">Your Passkeys ({allPasskeys.length})</h4>
              <div className="space-y-2">
                {allPasskeys.map((passkey, index) => (
                  <div key={passkey.id} className="flex items-center gap-2 p-2 border border-gray-800 text-xs bg-black/50">
                    <span className="w-4 text-gray-500">{index + 1}</span>
                    <div className="flex-1">
                      <div className="font-bold text-green-400">{passkey.label}</div>
                      <code className="font-mono text-xs">{passkey.ownerKeyHash}</code>
                    </div>
                    <div className="flex gap-1">
                      <button
                        className="px-2 py-1 border border-gray-800 hover:bg-gray-900 text-xs"
                        onClick={() => addOwner({ keyHash: passkey.ownerKeyHash as `0x${string}`, label: passkey.label })}
                        disabled={owners.some(o => o.keyHash === passkey.ownerKeyHash)}
                      >
                        {owners.some(o => o.keyHash === passkey.ownerKeyHash) ? 'Added' : 'Add'}
                      </button>
                      <button
                        className="px-2 py-1 bg-blue-600 text-white text-xs hover:bg-blue-700 disabled:opacity-50"
                        disabled={busy}
                        onClick={async () => {
                          await authorizePasskeyOnAccount(passkey);
                        }}
                      >
                        Authorize
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {owners.length > 0 && (
            <div className="space-y-1">
              <h4 className="font-bold text-sm mb-2">Current Owners ({owners.length})</h4>
              {owners.map((o, index) => (
                <div key={o.keyHash} className="flex items-center gap-2 p-2 border border-gray-800 text-xs">
                  <span className="w-4 text-gray-500">{index + 1}</span>
                  <div className="flex-1">
                    <code className="font-mono">{o.keyHash}</code>
                    {o.label && <span className="text-gray-500 ml-2">({o.label})</span>}
                  </div>
                  <button
                    className="px-2 py-1 border border-gray-800 hover:bg-gray-900"
                    onClick={() => removeOwner(o.keyHash)}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Threshold */}
        <div className="border border-gray-800 p-4 mb-4">
          <h2 className="font-bold mb-3">Threshold</h2>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              max={owners.length || 1}
              className="w-16 bg-black border border-gray-800 p-2 text-center text-sm focus:border-gray-600 outline-none"
              value={threshold}
              onChange={(e) => setThreshold(parseInt(e.target.value || '1', 10))}
            />
            <span className="text-xs text-gray-500">of {owners.length || 0} owners required to sign</span>
          </div>
        </div>

        {/* Actions */}
        <div className="border border-gray-800 p-4 mb-4">
          <h2 className="font-bold mb-3">Actions</h2>
          <div className="space-y-2">
            {/* Batched Setup Option */}
            <button
              className="w-full p-3 bg-green-600 text-white text-sm font-bold hover:bg-green-700 disabled:opacity-50"
              disabled={busy || sending || configExists || !address || !externalKeyHash || owners.length === 0 || threshold < 1 || threshold > owners.length}
              onClick={onCompleteMultisigSetup}
            >
              {busy ? 'Setting up...' : 'Complete Setup (Authorize Passkey + Initialize Multisig)'}
            </button>
            
            <button
              className="px-4 py-2 border border-gray-800 text-sm hover:bg-gray-900 disabled:opacity-50 mt-2"
              disabled={busy}
              onClick={() => refetch()}
            >
              Refresh Status
            </button>
          </div>
          
          {configExists && (
            <p className="text-xs text-yellow-500 mt-2">
              Multisig already initialized. Use "Refresh" to see latest config.
            </p>
          )}
          
          {!configExists && owners.length === 0 && (
            <p className="text-xs text-gray-400 mt-2">
              Add at least one owner to initialize the multisig.
            </p>
          )}

          {(sending || busy) && <p className="text-xs text-yellow-500 mt-2">Processing…</p>}
          {!!callId && <p className="text-xs text-gray-400 mt-2">Transaction ID: <code>{callId}</code></p>}
          {callsStatus?.status && (
            <p className="text-xs mt-2">
              Status:{' '}
              <span className={callsStatus.status === 'CONFIRMED' ? 'text-green-500' : 'text-yellow-500'}>
                {callsStatus.status}
              </span>
            </p>
          )}
          {callsStatus?.receipts?.length ? (
            <div className="mt-2 text-xs space-y-1">
              {callsStatus.receipts.map((r) => (
                <div key={r.transactionHash}>
                  Receipt: <code>{r.transactionHash}</code>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        {/* On-Chain Config */}
        {readData && (
          <div className="border border-gray-800 p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-bold">On-Chain Config</h2>
              <span className={`text-xs ${configExists ? 'text-green-500' : 'text-gray-500'}`}>
                {configExists ? 'Active' : 'Not initialized'}
              </span>
            </div>
            <div className="text-xs space-y-1 mb-3">
              <div>Threshold: {String((readData as any)?.[0] ?? 'N/A')}</div>
              <div>Owners: {(readData as any)?.[1]?.length ?? 0}</div>
            </div>
            {(readData as any)?.[1]?.length > 0 && (
              <div className="space-y-1">
                {(readData as any)[1].map((kh: string, index: number) => (
                  <div key={kh} className="flex items-center gap-2 text-xs">
                    <span className="w-4 text-gray-500">{index + 1}</span>
                    <code className="flex-1 font-mono">{kh}</code>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        </div>
        </>
        )}

        {/* Create Intent Tab */}
        {activeTab === 'create' && (
          <div className="space-y-4">
            <div className="border border-gray-800 p-4">
              <h2 className="font-bold mb-4">Create New Intent</h2>
              
              <div className="space-y-3">
                <div>
                  <label className="block text-sm mb-1">Account</label>
                  <input 
                    className="w-full bg-black border border-gray-800 p-2 text-sm focus:border-gray-600 outline-none" 
                    value={intentAccount} 
                    onChange={(e) => setIntentAccount(e.target.value as Hex)} 
                    placeholder="0x..."
                  />
                </div>

                <div>
                  <label className="block text-sm mb-1">External Key Hash</label>
                  <input 
                    className="w-full bg-black border border-gray-800 p-2 text-sm focus:border-gray-600 outline-none" 
                    value={intentExternalKeyHash} 
                    onChange={(e) => setIntentExternalKeyHash(e.target.value as Hex)} 
                    placeholder="0x..."
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-sm mb-1">To</label>
                    <input 
                      className="w-full bg-black border border-gray-800 p-2 text-sm focus:border-gray-600 outline-none" 
                      value={intentTo} 
                      onChange={(e) => setIntentTo(e.target.value as Hex)} 
                      placeholder="0x..."
                    />
                  </div>
                  <div>
                    <label className="block text-sm mb-1">Amount (wei)</label>
                    <input 
                      className="w-full bg-black border border-gray-800 p-2 text-sm focus:border-gray-600 outline-none" 
                      value={intentAmount} 
                      onChange={(e) => setIntentAmount(e.target.value)} 
                      placeholder="0"
                    />
                  </div>
                </div>

                <button 
                  onClick={createIntent} 
                  disabled={busy || !intentAccount || !intentExternalKeyHash || !intentTo}
                  className="w-full px-4 py-3 bg-blue-600 text-white font-bold hover:bg-blue-700 disabled:opacity-50"
                >
                  {busy ? 'Creating...' : 'Create Intent'}
                </button>
              </div>

              {intentId && (
                <div className="mt-6 p-3 border border-gray-800 space-y-2">
                  <div className="text-green-500 font-bold">✓ Intent Created Successfully</div>
                  <div className="text-xs space-y-1">
                    <div>Intent ID: <code className="break-all">{intentId}</code></div>
                    <div>Digest: <code className="break-all">{intentDigest}</code></div>
                  </div>
                  <div className="flex gap-2 pt-2">
                    <button 
                      className="px-3 py-1 bg-green-600 text-white text-xs hover:bg-green-700"
                      onClick={() => setActiveTab('sign')}
                    >
                      Go to Sign Tab
                    </button>
                    <button 
                      className="px-3 py-1 border border-gray-800 text-xs hover:bg-gray-900"
                      onClick={() => {
                        navigator.clipboard.writeText(`${window.location.origin}/intent/${intentId}`);
                        alert('Share URL copied to clipboard!');
                      }}
                    >
                      Copy Share URL
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Sign Intent Tab */}
        {activeTab === 'sign' && (
          <div className="space-y-4">
            <div className="border border-gray-800 p-4">
              <h2 className="font-bold mb-4">Sign Intent</h2>
              
              <div className="space-y-3">
                <div>
                  <label className="block text-sm mb-1">Intent ID</label>
                  <div className="flex gap-2">
                    <input 
                      className="flex-1 bg-black border border-gray-800 p-2 text-sm focus:border-gray-600 outline-none" 
                      value={signIntentId} 
                      onChange={(e) => setSignIntentId(e.target.value)} 
                      placeholder="Enter intent ID or paste URL"
                    />
                    <button 
                      onClick={() => {
                        const id = extractIntentId(signIntentId);
                        setSignIntentId(id);
                        loadIntent(id);
                      }}
                      disabled={busy || !signIntentId}
                      className="px-4 py-2 border border-gray-800 text-sm hover:bg-gray-900 disabled:opacity-50"
                    >
                      {busy ? 'Loading...' : 'Load'}
                    </button>
                  </div>
                </div>

                {loadedIntent && (
                  <div className="border border-gray-800 p-3">
                    <h3 className="font-bold text-sm mb-2">Intent Details</h3>
                    <div className="text-xs space-y-1">
                      <div>ID: <code>{loadedIntent.id}</code></div>
                      {loadedIntent.digest ? (
                        <div>Digest: <code className="break-all">{loadedIntent.digest}</code></div>
                      ) : (
                        <div className="text-yellow-500">⚠ Digest not loaded</div>
                      )}
                      <div>Status: <span className={signStatus.includes('ready') ? 'text-green-500' : 'text-yellow-500'}>{signStatus}</span></div>
                    </div>
                  </div>
                )}

                {/* Available Passkeys for Signing */}
                {(ownerKeyHash || allPasskeys.length > 0) && (
                  <div className="border border-gray-800 p-3">
                    <h3 className="font-bold text-sm mb-2">Available Passkeys ({(ownerKeyHash ? 1 : 0) + allPasskeys.length})</h3>
                    <div className="space-y-2">
                      {/* Primary passkey */}
                      {ownerKeyHash && (
                        <div className="flex items-center gap-2 p-2 border border-gray-800 bg-green-900/20">
                          <div className="flex-1 text-xs">
                            <div className="text-green-400 font-bold">Primary Passkey</div>
                            <code className="text-xs break-all">{ownerKeyHash}</code>
                          </div>
                          <button
                            className="px-3 py-2 bg-blue-600 text-white text-xs font-bold hover:bg-blue-700 disabled:opacity-50"
                            disabled={busy || !loadedIntent?.digest}
                            onClick={signIntent}
                          >
                            {busy ? 'Signing...' : 'Sign'}
                          </button>
                        </div>
                      )}
                      
                      {/* Additional passkeys */}
                      {allPasskeys.map((passkey) => (
                        <div key={passkey.id} className="flex items-center gap-2 p-2 border border-gray-800 bg-blue-900/20">
                          <div className="flex-1 text-xs">
                            <div className="text-blue-400 font-bold">{passkey.label}</div>
                            <code className="text-xs break-all">{passkey.ownerKeyHash}</code>
                          </div>
                          <button
                            className="px-3 py-2 bg-blue-600 text-white text-xs font-bold hover:bg-blue-700 disabled:opacity-50"
                            disabled={busy || !loadedIntent?.digest}
                            onClick={() => signWithPasskey(passkey)}
                          >
                            {busy ? 'Signing...' : 'Sign'}
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex gap-2">
                  <button
                    className="flex-1 px-4 py-3 bg-green-600 text-white font-bold hover:bg-green-700 disabled:opacity-50"
                    disabled={busy || !signStatus.includes('ready')}
                    onClick={submitIntent}
                  >
                    {busy ? 'Submitting...' : 'Submit Intent'}
                  </button>
                </div>

                {!ownerKeyHash && allPasskeys.length === 0 && (
                  <div className="p-3 bg-yellow-900/20 border border-yellow-800 text-yellow-400 text-sm">
                    ⚠ No Porto passkeys found. Please create one in the Setup tab first.
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

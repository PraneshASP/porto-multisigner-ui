'use client';
import { useAccount, useConnect, useDisconnect } from 'wagmi';

export default function Connect() {
  const { address, isConnected } = useAccount();
  const { connectors, connect, status, error } = useConnect();
  const { disconnect } = useDisconnect();

  return (
    <div className="flex items-center gap-2 text-xs">
      {isConnected ? (
        <>
          <span className="font-mono bg-gray-900 px-2 py-1 border border-gray-800">
            {address?.slice(0, 6)}...{address?.slice(-4)}
          </span>
          <button className="px-2 py-1 border border-gray-800 hover:bg-gray-900" onClick={() => disconnect()}>
            Disconnect
          </button>
        </>
      ) : (
        // Only show Porto connector
        connectors
          .filter((c) => c.name.toLowerCase().includes('porto'))
          .map((c) => (
            <button key={c.uid} className="px-2 py-1 bg-white text-black hover:bg-gray-200" onClick={() => connect({ connector: c })}>
              Connect (Porto)
            </button>
          ))
      )}
      {status === 'pending' && <span className="text-gray-500">Connecting...</span>}
      {error && <span className="text-red-500">{error.message}</span>}
    </div>
  );
}
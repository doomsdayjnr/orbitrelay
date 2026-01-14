// src/app/page.tsx
"use client";

import { useConnection, useWallet, useAnchorWallet } from '@solana/wallet-adapter-react';
import { WalletModalProvider, WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { PhantomWalletAdapter } from '@solana/wallet-adapter-wallets';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { clusterApiUrl, PublicKey } from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';
import { useCallback, useState } from 'react';
import idl from '../../../https-gateway/target/idl/https_gateway.json';
import '@solana/wallet-adapter-react-ui/styles.css';

const wallets = [new PhantomWalletAdapter()];
const network = clusterApiUrl('devnet');
// window.Buffer = window.Buffer || Buffer;

export default function Home() {
  return (
    <ConnectionProvider endpoint={network}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <App />
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}

function getByPath(obj: any, path: string): any {
  return path.split('.').reduce((acc, key) => {
    if (acc && typeof acc === 'object') {
      return acc[key];
    }
    return undefined;
  }, obj);
}

function App() {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const anchorWallet = useAnchorWallet();  // ← MAGIC: This is your pre-wrapped AnchorWallet!
  const [loading, setLoading] = useState(false);
  const [url, setUrl] = useState("");
  const [jsonPath, setJsonPath] = useState("");
  const [result, setResult] = useState<any>(null);

  const requestData = useCallback(async () => {
    if (!publicKey || !anchorWallet) {
      alert("Connect wallet first!");
      return;
    }

    if (!url || !jsonPath) {
      alert("Enter URL and JSON path");
      return;
    }

    setLoading(true);
    setResult(null);

    try {
      const provider = new anchor.AnchorProvider(connection, anchorWallet, {
        commitment: 'confirmed',
        preflightCommitment: 'confirmed',
      });
      const program = new anchor.Program(idl as any, provider);

      const requestSlot = Date.now() + Math.floor(Math.random() * 1000);
      console.log("Request Slot:", requestSlot);
      // const url = "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd";
      const requestUrl = url;
      const requestJsonPath = jsonPath;


      // === DERIVE THE REQUEST PDA ===
      const [requestPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("request"),
          publicKey.toBuffer(),
          new anchor.BN(requestSlot).toArrayLike(Buffer, 'le', 8),
        ],
        program.programId
      );
     
      // === DERIVE THE RESPONSE PDA ===
      const [responsePda] = PublicKey.findProgramAddressSync(
        [Buffer.from("response"), requestPda.toBuffer()],
        program.programId
      );

      console.log("requestPda:", requestPda.toBase58());
      console.log("responsePda:", responsePda.toBase58());

      // Send request
       await program.methods
        .requestData(requestUrl, requestJsonPath, new anchor.BN(requestSlot))
        .accounts({ dataRequest: requestPda, user: publicKey, })
        .rpc();

    

      // === POLL FOR RESPONSE ===
      const pollInterval = setInterval(async () => {
        try {
          const accountInfo = await connection.getAccountInfo(responsePda);
          console.log("accountInfo", accountInfo);
          
          if (accountInfo) {
            clearInterval(pollInterval);

            const decoded = program.coder.accounts.decode("dataResponse", accountInfo.data)
            
            // Real JSON bytes from ZK proof!
            const jsonString = new TextDecoder().decode(Uint8Array.from(decoded.data));
            const jsonData = JSON.parse(jsonString);
            console.log("jsonData", jsonData);
            
            // Extract using json_path
            const extracted = getByPath(jsonData, jsonPath);
            setResult(extracted ?? "Path not found");
            
            setLoading(false);
          }
        } catch (err) {
          // Still waiting...
        }
      }, 2000);

      // Timeout after 30s
      setTimeout(() => {
        clearInterval(pollInterval);
        setResult("Timeout — check relayer logs");
        setLoading(false);
      }, 300000);

    } catch (err: any) {
      console.error(err);
      alert("Error: " + err.message);
      setLoading(false);
    }
  }, [connection, publicKey, anchorWallet, url, jsonPath]);

  return (
    <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center gap-12 px-4">
      <div className="text-center">
        <h1 className="text-7xl font-bold bg-gradient-to-r from-purple-400 via-pink-500 to-red-500 bg-clip-text text-transparent mb-4">
          OrbitRelay
        </h1>
        <p className="text-2xl opacity-90">ZK-Verified HTTPS → Solana in &lt;2 seconds</p>
      </div>

      <WalletMultiButton className="!bg-purple-600 hover:!bg-purple-700" />

      <input
        type="text"
        placeholder="HTTPS API URL"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        className=" w-full max-w-2xl
        px-4 py-3
        rounded-xl
        bg-white/90 backdrop-blur
        text-black
        placeholder-gray-600
        border border-white/20
        focus:outline-none
        focus:ring-2 focus:ring-pink-500"
      />

      <input
        type="text"
        placeholder="JSON path (e.g. solana.usd)"
        value={jsonPath}
        onChange={(e) => setJsonPath(e.target.value)}
        className=" w-full max-w-2xl
        px-4 py-3
        rounded-xl
        bg-white/90 backdrop-blur
        text-black
        placeholder-gray-600
        border border-white/20
        focus:outline-none
        focus:ring-2 focus:ring-pink-500"
      />

      <button
        onClick={requestData}
        disabled={loading || !publicKey}
        className="px-16 py-8 text-3xl font-bold rounded-2xl bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 disabled:opacity-50 transition-all transform hover:scale-105 shadow-2xl"
      >
        {loading ? "Requesting..." : "Request any HTTPS endpoint + extract any JSON field"}
      </button>

      {result !== null && (
        <pre className="max-w-3xl text-lg bg-gray-900 p-6 rounded-xl overflow-x-auto">
          {JSON.stringify(result, null, 2)}
        </pre>
      )}
    </div>
  );
}
// src/app/page.tsx
"use client";

import { useConnection, useWallet, useAnchorWallet } from '@solana/wallet-adapter-react';
import { WalletModalProvider, WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { PhantomWalletAdapter } from '@solana/wallet-adapter-wallets';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { PublicKey, ComputeBudgetProgram } from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';
import { useCallback, useState } from 'react';
import idl from '../../../https-gateway/target/idl/https_gateway.json';
import '@solana/wallet-adapter-react-ui/styles.css';

const wallets = [new PhantomWalletAdapter()];
const network = "https://devnet.helius-rpc.com/?api-key=" + process.env.NEXT_PUBLIC_HELIUS_KEY;
// window.Buffer = window.Buffer || Buffer;
const PRESETS = [
  {
    label: "SOL / USD (CoinGecko)",
    url: "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd",
    jsonPath: "solana.usd",
  },
  {
    label: "BTC / USD (CoinGecko)",
    url: "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd",
    jsonPath: "bitcoin.usd",
  },
  {
    label: "ETH / USD (CoinGecko)",
    url: "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd",
    jsonPath: "ethereum.usd",
  },
  {
    label: "Random Number (Random API)",
    url: "https://www.randomnumberapi.com/api/v1.0/random?min=1&max=100&count=1",
    jsonPath: "0",
  },
  {
    label: "Temperature (Open-Meteo)",
    url: "https://api.open-meteo.com/v1/forecast?latitude=51.5072&longitude=-0.1276&current=temperature_2m",
    jsonPath: "current.temperature_2m",
  },
];


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
  const [selectedPreset, setSelectedPreset] = useState<number | null>(0);

  const applyPreset = (index: number) => {
    const preset = PRESETS[index];
    setSelectedPreset(index);
    setUrl(preset.url);
    setJsonPath(preset.jsonPath);
  };

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
      const FEE_LAMPORTS = new anchor.BN(0.01 * anchor.web3.LAMPORTS_PER_SOL);
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

      // === DERIVE THE ESCROW PDA ===
      const [escrowPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("escrow"),
          requestPda.toBuffer(),
        ],
        program.programId
      );

      console.log("requestPda:", requestPda.toBase58());
      console.log("responsePda:", responsePda.toBase58());
      console.log("escrowPda:", escrowPda.toBase58());

      console.log("Fetching Helius Priority Fee...");

      // 1. Get Priority Fee Estimate from Helius
      const response = await fetch(network, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: '1',
          method: 'getPriorityFeeEstimate',
          params: [{
            accountKeys: [program.programId.toBase58()], // Watch accounts related to your program
            options: {
              recommended: true
            }
          }]
        }),
      });
      const data = await response.json();
      const priorityFee = data.result?.priorityFeeEstimate || 1000; // Default fallback
      console.log("Priority Fee:", priorityFee);

      // 2. Add Compute Budget Instruction
      const computePriceIx = ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: priorityFee
      });

      // 3. Build and Send Transaction manually (so we can add the fee)
      const tx = new anchor.web3.Transaction();
      tx.add(computePriceIx); // Add the fee instruction FIRST
      
      const ix = await program.methods
        .requestData(requestUrl, requestJsonPath, new anchor.BN(requestSlot), FEE_LAMPORTS)
        .accounts({ dataRequest: requestPda, escrow: escrowPda, user: publicKey })
        .instruction();
        
      tx.add(ix);

      // 4. Send using Provider (handles signing)
      const signature = await provider.sendAndConfirm(tx);
      console.log("Transaction Signature:", signature);

     
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
        <h1 className="text-6xl font-bold bg-gradient-to-r from-purple-400 via-pink-500 to-red-500 bg-clip-text text-transparent mb-4">
          OrbitRelay
        </h1>
        <p className="text-xl opacity-90">ZK-Verified HTTPS → Solana in &lt;2 seconds</p>
      </div>

      <WalletMultiButton className="!bg-purple-600 hover:!bg-purple-700" />

      <div className="w-full max-w-2xl">
        <select
          value={selectedPreset ?? ""}
          onChange={(e) => applyPreset(Number(e.target.value))}
          className="
            w-full px-4 py-2 rounded-xl
            bg-white/90 text-black
            border border-white/20
            focus:outline-none focus:ring-2 focus:ring-purple-500
          "
        >
          {PRESETS.map((preset, i) => (
            <option key={i} value={i}>
              {preset.label}
            </option>
          ))}
        </select>

        <p className="mt-2 text-sm text-white/70">
          Preset oracle feeds (ZK-verified HTTPS)
        </p>
      </div>

      <div className="w-full max-w-2xl mt-6 space-y-4">
        <p className="text-white/70 text-sm">
          Advanced: custom HTTPS endpoint
        </p>
        <input
          type="text"
          placeholder="HTTPS API URL"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          className=" w-full max-w-2xl
          px-4 py-2
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
          px-4 py-2
          rounded-xl
          bg-white/90 backdrop-blur
          text-black
          placeholder-gray-600
          border border-white/20
          focus:outline-none
          focus:ring-2 focus:ring-pink-500"
        />
      </div>
      <button
        onClick={requestData}
        disabled={loading || !publicKey}
        className="px-16 py-2 text-xl font-bold rounded-2xl bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 disabled:opacity-50 transition-all transform hover:scale-105 shadow-2xl"
      >
        {loading ? "Requesting..." : "Request ZK-Verified Data"}
      </button>

      {result !== null && (
        <pre className="max-w-3xl text-lg bg-gray-900 p-4 rounded-xl overflow-x-auto">
          {JSON.stringify(result, null, 2)}
        </pre>
      )}
    </div>
  );
}
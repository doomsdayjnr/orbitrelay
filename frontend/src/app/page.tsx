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

function App() {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const anchorWallet = useAnchorWallet();  // ← MAGIC: This is your pre-wrapped AnchorWallet!
  const [loading, setLoading] = useState(false);
  const [price, setPrice] = useState<string | null>(null);

  const getPrice = useCallback(async () => {
    if (!publicKey || !anchorWallet) {
      alert("Connect wallet first!");
      return;
    }

    setLoading(true);
    setPrice(null);

    try {
      const provider = new anchor.AnchorProvider(connection, anchorWallet, {
        commitment: 'confirmed',
        preflightCommitment: 'confirmed',
      });
      const program = new anchor.Program(idl as any, provider);

      const requestSlot = Date.now() + Math.floor(Math.random() * 1000);
      console.log("Request Slot:", requestSlot);
      const url = "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd";


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
      const txSig = await program.methods
        .requestData(url, "solana.usd", new anchor.BN(requestSlot))
        .accounts({ dataRequest: requestPda, user: publicKey, })
        .rpc();

      alert(`Request sent! Tx: ${txSig}\nWaiting for ZK proof...`);

      console.log("TX", txSig);



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
            const price = jsonData.solana?.usd;
            console.log("Price", price);
            
            if (price) {
              setPrice(price.toFixed(2));
            } else {
              setPrice("Error parsing price");
            }
            
            setLoading(false);
          }
        } catch (err) {
          // Still waiting...
        }
      }, 2000);

      // Timeout after 30s
      setTimeout(() => {
        clearInterval(pollInterval);
        if (loading) {
          setPrice("Timeout — check relayer logs");
          setLoading(false);
        }
      }, 30000);

    } catch (err: any) {
      console.error(err);
      alert("Error: " + err.message);
      setLoading(false);
    }
  }, [connection, publicKey, anchorWallet, loading]);

  return (
    <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center gap-12 px-4">
      <div className="text-center">
        <h1 className="text-7xl font-bold bg-gradient-to-r from-purple-400 via-pink-500 to-red-500 bg-clip-text text-transparent mb-4">
          OrbitRelay
        </h1>
        <p className="text-2xl opacity-90">ZK-Verified HTTPS → Solana in &lt;2 seconds</p>
      </div>

      <WalletMultiButton className="!bg-purple-600 hover:!bg-purple-700" />

      <button
        onClick={getPrice}
        disabled={loading || !publicKey}
        className="px-16 py-8 text-3xl font-bold rounded-2xl bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 disabled:opacity-50 transition-all transform hover:scale-105 shadow-2xl"
      >
        {loading ? "Requesting..." : "Get SOL Price"}
      </button>

      {price && (
        <div className="text-6xl font-bold animate-pulse">
          SOL = <span className="text-green-400">${price}</span>
        </div>
      )}
    </div>
  );
}
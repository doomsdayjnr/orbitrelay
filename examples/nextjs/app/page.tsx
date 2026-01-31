"use client";

import { useConnection, useWallet, useAnchorWallet } from "@solana/wallet-adapter-react";
import { OrbitRelay } from "@orbit-relay/sdk";
import { PublicKey } from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
import idl from "../../../https-gateway/target/idl/https_gateway.json";

export default function Page() {
  const { connection } = useConnection();
  const wallet = useAnchorWallet();
  const { publicKey } = useWallet();

  async function run() {
    if (!wallet || !publicKey) return;

    const provider = new anchor.AnchorProvider(connection, wallet, {});
    const program = new anchor.Program(idl as any, provider);

    const relay = new OrbitRelay({
      connection,
      wallet,
      program,
      programId: new PublicKey(idl.address),
    });

    const result = await relay.request({
      url: "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd",
      jsonPath: "solana.usd",
    });

    console.log("Verified value:", result.value);
  }

  return (
    <button onClick={run}>
      Request ZK-Verified Price
    </button>
  );
}
import { PublicKey } from "@solana/web3.js";

export interface OrbitRelayConfig {
  connection: any; // Connection (avoid importing type here yet)
  wallet: any;     // WalletAdapter
  programId: PublicKey;
}

export interface RequestParams {
  url: string;
  jsonPath: string;
  feeLamports?: number;
  timeoutMs?: number;
}

export interface RelayResult {
  requestId: PublicKey;
  fulfilledSlot: number;
  rawJson: any;
  value: any;
}
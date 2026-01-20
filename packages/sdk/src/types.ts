import { PublicKey } from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";

export interface OrbitRelayConfig {
  program: anchor.Program;   // <-- user passes this
  connection: any;
  wallet: any;
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
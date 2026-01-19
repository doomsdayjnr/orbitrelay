import { PublicKey } from "@solana/web3.js";
import { OrbitRelayConfig, RequestParams, RelayResult } from "./types";

export class OrbitRelay {
  private connection;
  private wallet;
  private programId: PublicKey;

  constructor(config: OrbitRelayConfig) {
    this.connection = config.connection;
    this.wallet = config.wallet;
    this.programId = config.programId;
  }

  async request(params: RequestParams): Promise<RelayResult> {
    throw new Error("Not implemented yet");
  }
}
import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { OrbitRelayConfig, RequestParams, RelayResult } from "./types";
import { deriveRequestPda, deriveResponsePda } from "./pdas";

export class OrbitRelay {
  private connection;
  private wallet;
  private program: anchor.Program;
  private programId: PublicKey;

  constructor(config: OrbitRelayConfig) {
    this.connection = config.connection;
    this.wallet = config.wallet;
    this.program = config.program;
    this.programId = config.programId;
  }

  async request(params: RequestParams): Promise<RelayResult> {
    const { url, jsonPath, timeoutMs = 300_000 } = params;

    if (!this.wallet?.publicKey) {
      throw new Error("Wallet not connected");
    }

    const requestSlot = Date.now() + Math.floor(Math.random() * 1000);

    const requestPda = deriveRequestPda(
      this.programId,
      this.wallet.publicKey,
      requestSlot
    );

    const responsePda = deriveResponsePda(this.programId, requestPda);

    await this.program.methods
      .requestData(url, jsonPath, new anchor.BN(requestSlot))
      .accounts({
        dataRequest: requestPda,
        user: this.wallet.publicKey,
      })
      .rpc();

    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
      const accountInfo = await this.connection.getAccountInfo(responsePda);

      if (accountInfo) {
        const decoded = this.program.coder.accounts.decode(
          "dataResponse",
          accountInfo.data
        );

        const jsonString = new TextDecoder().decode(
          Uint8Array.from(decoded.data)
        );

        const rawJson = JSON.parse(jsonString);
        const value = jsonPath
          .split(".")
          .reduce((acc, key) => acc?.[key], rawJson);

        return {
          requestId: requestPda,
          fulfilledSlot: decoded.fulfilledSlot ?? 0,
          rawJson,
          value,
        };
      }

      await new Promise((r) => setTimeout(r, 2000));
    }

    throw new Error("OrbitRelay request timed out");
  }
}
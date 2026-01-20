import { PublicKey } from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";

export function deriveRequestPda(
  programId: PublicKey,
  user: PublicKey,
  requestSlot: number
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("request"),
      user.toBuffer(),
      new anchor.BN(requestSlot).toArrayLike(Buffer, "le", 8),
    ],
    programId
  );

  return pda;
}

export function deriveResponsePda(
  programId: PublicKey,
  requestPda: PublicKey
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("response"), requestPda.toBuffer()],
    programId
  );

  return pda;
}
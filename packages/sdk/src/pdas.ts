import { PublicKey } from "@solana/web3.js";

export function deriveDataRequestPda(
  programId: PublicKey,
  user: PublicKey,
  requestSlot: bigint
): PublicKey {
  const slotBuf = Buffer.alloc(8);
  slotBuf.writeBigUInt64LE(requestSlot);

  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("request"),
      user.toBuffer(),
      slotBuf
    ],
    programId
  )[0];
}

export function deriveDataResponsePda(
  programId: PublicKey,
  dataRequest: PublicKey
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("response"),
      dataRequest.toBuffer()
    ],
    programId
  )[0];
}

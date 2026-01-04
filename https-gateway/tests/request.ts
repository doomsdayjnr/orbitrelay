import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { HttpsGateway } from "../target/types/https_gateway";

// Auto-fix missing env vars (put this at the very top of the file)
if (!process.env.ANCHOR_PROVIDER_URL) {
  process.env.ANCHOR_PROVIDER_URL = "https://api.devnet.solana.com";
}
if (!process.env.ANCHOR_WALLET) {
  process.env.ANCHOR_WALLET = require("os").homedir() + "/.config/solana/id.json";
}

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const connection = provider.connection;  

  const program = anchor.workspace.HttpsGateway as Program<HttpsGateway>;

  const url = "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd";

  // Get slot for request_slot seed
  const requestSlot = await connection.getSlot();

  const tx = await program.methods
    .requestData(url, "solana.usd", new anchor.BN(requestSlot)) 
    .accounts({
      user: provider.wallet.publicKey,
    })
    .rpc();

  console.log("Request sent! Signature:", tx);
  console.log("Check your relayer terminal now...");
}

main();

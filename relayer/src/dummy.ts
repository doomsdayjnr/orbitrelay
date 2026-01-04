import { Connection, Keypair, PublicKey, SystemProgram, VersionedTransaction, TransactionMessage } from '@solana/web3.js';
import bs58 from 'bs58';
import axios from 'axios';
import WebSocket from 'ws';
import { BorshCoder, AnchorProvider, Wallet, Program, Idl, EventParser } from '@coral-xyz/anchor';
import anchorIdl from "../../https-gateway/target/idl/https_gateway.json";
import { execSync } from 'child_process';
import { searcher, bundle } from "jito-ts";
import * as fs from 'fs';
import { BundleResult } from 'jito-ts/dist/gen/block-engine/bundle';
require('dotenv').config();

console.log("=== ORBITRELAY RELAYER DEBUG MODE ===");
console.log("Expected PROGRAM_ID from .env:", process.env.PROGRAM_ID);
console.log("IDL program address:", anchorIdl.address);

// Config
const PROGRAM_ID = new PublicKey(process.env.PROGRAM_ID!);
const RPC_URL = process.env.RPC_URL || 'https://api.devnet.solana.com';
const BLOCK_ENGINE_URL = process.env.BLOCK_ENGINE_URL;
const CONNECTION = new Connection(RPC_URL, 'confirmed');
const TIP_AMOUNT = 1000; // lamports

console.log("→ Watching program:", PROGRAM_ID.toBase58());
console.log("→ Using RPC:", RPC_URL);

export const RELAYER_KEYPAIR = Keypair.fromSecretKey(
  Uint8Array.from(
    JSON.parse(
      fs.readFileSync(process.env.HOME + '/.config/solana/id.json', 'utf-8')
    )
  )
);

if (!BLOCK_ENGINE_URL) throw new Error("BLOCK_ENGINE_URL not set");
const client = searcher.searcherClient(BLOCK_ENGINE_URL);

// Create coder & parser from generated IDL
const coder = new BorshCoder(anchorIdl as unknown as Idl);
const eventParser = new EventParser(
  new PublicKey(anchorIdl.address), 
  coder
);

// Websocket (ensure your RPC supports ws; some providers use a separate websocket URL)
const wsUrl = RPC_URL.replace(/^https?:\/\//, RPC_URL.startsWith('https') ? 'wss://' : 'ws://').replace('api.', 'api.');
console.log("→ Connecting to WebSocket:", wsUrl);
const ws = new WebSocket(wsUrl);

ws.on("open", () => {
  console.log("WebSocket connected");
  
  ws.send(JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "programSubscribe",
    params: [
      PROGRAM_ID.toBase58(),
      {
        commitment: "confirmed",
        encoding: "base64",
        logs: "all" 
      }
    ],
  }));

  // Heartbeat
  setInterval(() => {
    ws.send(JSON.stringify({ method: "ping" }));
  }, 20_000);
});


ws.on('message', async (rawData: string) => {
  try {
    const msg = typeof rawData === 'string' ? JSON.parse(rawData) : rawData;
    
    console.log("\nRAW MESSAGE RECEIVED:", JSON.stringify(msg, null, 2));
   
    // programSubscribe notifications use "programNotification"
    if (msg.method === "programNotification") {
      const accountKey = msg.params?.result?.value?.pubkey;
      const logs = msg.params?.result?.value?.logs || [];

      console.log("PROGRAM NOTIFICATION!");
      console.log("→ Account:", accountKey);
      console.log("→ Logs count:", logs.length);
      console.log("→ Logs:", logs);

      // Use EventParser to find & decode events
      const events = eventParser.parseLogs(logs);


      for (const ev of events) {
        console.log("EVENT DETECTED:", ev.name, ev.data);
        
        if (ev.name === 'DataRequested') {
          console.log("DATAREQUESTED EVENT FIRED!");
          const data = ev.data as any;
          const requestId = new PublicKey(data.requestId);
          const url = data.url as string;
          
          console.log("Request ID:", requestId.toBase58());
          console.log("URL:", url);
          
          await processRequest(requestId, url);
        }
      }
    }
  } catch (e) {
    console.error('ws message handler error:', e);
  }
});

async function processRequest(requestId: PublicKey, url: string) {
  try {
    // Step 1: Fetch
    console.log(`Fetching: ${url}`);
    const { data } = await axios.get(url, { timeout: 5000 });
    const responseBytes = Buffer.from(JSON.stringify(data));

    // Step 2: SP1 proof (same as you had)
    fs.writeFileSync('./sp1-fetch/input.txt', url);
    execSync('cd sp1-fetch && RUST_LOG=info cargo prove build --hypercube', { stdio: 'inherit' });
    execSync('cd sp1-fetch && cargo prove generate-proof --hypercube input.txt proof.bin', { stdio: 'inherit' });
    const sp1Proof = fs.readFileSync('./sp1-fetch/proof.bin');

    // Compute URL hash (Node >= 18: crypto.subtle; fallback below if you need)
    let urlHashBytes: Uint8Array;
    if ((globalThis as any).crypto?.subtle) {
      const encoder = new TextEncoder();
      const hashBuffer = await (globalThis as any).crypto.subtle.digest('SHA-256', encoder.encode(url));
      urlHashBytes = new Uint8Array(hashBuffer);
    } else {
      // fallback (Node < 18) - use node's crypto module
      const nodeCrypto = require('crypto');
      urlHashBytes = nodeCrypto.createHash('sha256').update(url).digest();
    }
    const publicInputs = [urlHashBytes];

    // Step 3: Build instruction
    const provider = new AnchorProvider(CONNECTION, new Wallet(RELAYER_KEYPAIR), { commitment: 'confirmed' });
    const programIdl = await Program.fetchIdl(PROGRAM_ID, provider);
    if (!programIdl) throw new Error('IDL not found – run `anchor idl init`');
    const program = new Program(programIdl as any, provider);

    const requestAccount: any = await (program.account as any).dataRequest.fetch(requestId);
    const userKey = requestAccount.owner as PublicKey;
    const requestSlot = Number(requestAccount.requestSlot);
    const slotBuffer = Buffer.alloc(8);
    slotBuffer.writeBigUInt64LE(BigInt(requestSlot), 0);

    const [dataRequestPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('request'), userKey.toBuffer(), slotBuffer],
      PROGRAM_ID
    );
    console.log("Data Request PDA:", dataRequestPda);
    const [responsePda] = PublicKey.findProgramAddressSync(
      [Buffer.from('response'), dataRequestPda.toBuffer()],
      PROGRAM_ID
    );
    console.log("Response PDA:", responsePda);

    const ix = await program.methods
      .fulfillRequest(responseBytes, Array.from(sp1Proof), publicInputs)
      .accounts({
        dataRequest: dataRequestPda,
        response: responsePda,
        relayer: RELAYER_KEYPAIR.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .instruction();

    // Step 4: Build VersionedTransaction
    const latest = await CONNECTION.getLatestBlockhash('confirmed');

    // fulfill tx
    const fulfillMsg = new TransactionMessage({
      payerKey: RELAYER_KEYPAIR.publicKey,
      recentBlockhash: latest.blockhash,
      instructions: [ix],
    }).compileToV0Message();
    const fulfillVTx = new VersionedTransaction(fulfillMsg);
    fulfillVTx.sign([RELAYER_KEYPAIR]);

    // tip tx
    const tipIx = SystemProgram.transfer({
      fromPubkey: RELAYER_KEYPAIR.publicKey,
      toPubkey: await pickTipAccount(client),
      lamports: TIP_AMOUNT,
    });
    const tipMsg = new TransactionMessage({
      payerKey: RELAYER_KEYPAIR.publicKey,
      recentBlockhash: latest.blockhash,
      instructions: [tipIx],
    }).compileToV0Message();
    const tipVTx = new VersionedTransaction(tipMsg);
    tipVTx.sign([RELAYER_KEYPAIR]);

    // Step 5: Send via Jito searcher client
    if (client) {

      const txbundle = new bundle.Bundle([fulfillVTx, tipVTx], 5); // 5 = max attempts / priority
      
      const onSuccess = (bundleResult: BundleResult) => {
        console.log("Bundle sent successfully! "+bundleResult.bundleId);
        if(bundleResult.accepted){
          console.log("Bundle was accepted! "+bundleResult.accepted);
        }
        if(bundleResult.rejected){
          console.log("Bundle was rejected! "+bundleResult.rejected);
        }
        if(bundleResult.dropped){
          console.log("Bundle was dropped! "+bundleResult.dropped);
        }
      }
      const onError = (e: Error) => {
        console.log("Coulld not send bundle! "+e);
      }

      client.onBundleResult(onSuccess, onError);
      
      const uuid = await client.sendBundle(txbundle);
      console.log('Bundle sent via Jito:', uuid);

      console.log('Jito timeout, fallback to on-chain submit...');
    }

    if (!client) {
      // Fallback: send the VersionedTransaction directly
      const rawTx = fulfillVTx.serialize(); // serialize signed VersionedTransaction
      const txSig = await CONNECTION.sendRawTransaction(rawTx, { skipPreflight: false, preflightCommitment: 'confirmed' });

      // Wait for confirmation
      const latestBlockhash = await CONNECTION.getLatestBlockhash();
      await CONNECTION.confirmTransaction(
        { signature: txSig, ...latestBlockhash },
        'confirmed'
      );
      console.log('Fallback sig:', txSig);
    }

  } catch (err) {
    console.error('Process error:', err);
  }
}

// helper to pick tip account (unwraps Result)
async function pickTipAccount(clientInstance: any): Promise<PublicKey> {
  const tipAccountsResult = await clientInstance.getTipAccounts();
  if (!tipAccountsResult.ok) throw new Error(`Failed to fetch Jito tip accounts: ${tipAccountsResult.error}`);
  const tipAccounts = tipAccountsResult.value;
  if (!tipAccounts?.length) throw new Error('No tip accounts available');
  return new PublicKey(tipAccounts[Math.floor(Math.random() * tipAccounts.length)]);
}

console.log('Relayer listening on', RPC_URL);

// SPDX-License-Identifier: Apache-2.0
import { Connection, Keypair, PublicKey, SystemProgram, VersionedTransaction, TransactionMessage } from '@solana/web3.js';
import bs58 from 'bs58';
import axios from 'axios';
import WebSocket from 'ws';
import { BorshCoder, AnchorProvider, Wallet, Program, Idl, EventParser, BN } from '@coral-xyz/anchor';
import anchorIdl from "../../https-gateway/target/idl/https_gateway.json";
import { execSync, execFile } from 'child_process';
import { promisify } from 'util';
import { searcher, bundle } from "jito-ts";
import * as fs from 'fs';
import { BundleResult } from 'jito-ts/dist/gen/block-engine/bundle';
import path from 'path';

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
// jito-ts searcher client expects gRPC address format (hostname:port)
let client: any = null;
try {
  const blockEngineAddress = BLOCK_ENGINE_URL.replace(/^https?:\/\//, '').split('/')[0] + ':443';
  client = searcher.searcherClient(blockEngineAddress);
  console.log("→ Jito Block Engine client initialized:", blockEngineAddress);
} catch (err) {
  console.warn("⚠️  Failed to initialize Jito client. Will use fallback RPC submission:", err);
}

// Create coder & parser from generated IDL
const coder = new BorshCoder(anchorIdl as unknown as Idl);
const eventParser = new EventParser(
  new PublicKey(anchorIdl.address), 
  coder
);

const VKEY_HASH = "0x003f895fc57a319b3b85c3916190bc00e0d250902916c68bd889640a62871859";
if (!VKEY_HASH) throw new Error("VKEY_HASH not set in .env file");

// Websocket (ensure your RPC supports ws; some providers use a separate websocket URL)
const wsUrl = RPC_URL.replace(/^https?:\/\//, RPC_URL.startsWith('https') ? 'wss://' : 'ws://').replace('api.', 'api.');
console.log("→ Connecting to WebSocket:", wsUrl);
const ws = new WebSocket(wsUrl);

ws.on("open", () => {
  console.log("WebSocket connected");
  
   ws.send(JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "logsSubscribe",
    params: [
      {
        mentions: [PROGRAM_ID.toBase58()]
      },
      {
        commitment: "confirmed"
      }
    ]
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
    if (msg.method === "logsNotification") {
      const logs = msg.params.result.value.logs;
      console.log("LOGS:", logs);

      const events = eventParser.parseLogs(logs);

      for (const e of events) {
        console.log("EVENT:", e.name, e.data);
        // inside your logsNotification handler where you have `const e`:
        if (e.name === 'DataRequested') {
          console.log("DATAREQUESTED EVENT FIRED!");
          const data = e.data as any;

          // robustly read either snake_case or camelCase field
          const rawRequestId = data.request_id ?? data.requestId ?? data.requestIdBytes ?? data.requestIdRaw;

          let requestId: PublicKey;
          try {
            if (typeof rawRequestId === 'string') {
              requestId = new PublicKey(rawRequestId);
            } else if (rawRequestId instanceof PublicKey) {
              requestId = rawRequestId;
            } else if (rawRequestId && typeof rawRequestId.toBase58 === 'function') {
              // some objects have a toBase58 method
              requestId = new PublicKey(rawRequestId.toBase58());
            } else if (rawRequestId && rawRequestId._bn) {
              // weird case: a BN-like inside object — try to stringify
              console.warn('request_id looks like BN-like object; converting via toString()');
              requestId = new PublicKey(rawRequestId.toString());
            } else {
              throw new Error('unrecognized request_id format');
            }
          } catch (err) {
            console.error('Failed to construct PublicKey from event data. Raw event data:', data, err);
            return; // bail so we don't crash the whole ws handler
          }

          const url = (data.url ?? data._url ?? data.request_url) as string;
          if (!url) {
            console.error('No URL found on event data:', data);
            return;
          }

          console.log("Request ID:", requestId.toBase58());
          console.log("URL:", url);

          try {
            await processRequest(requestId, url);
          } catch (err) {
            console.error('processRequest failed:', err);
          }
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

    // Step 2: SP1 proof — FIXED (no pseudo code)
    const inputContent = `${url}\n${responseBytes}`;
    fs.writeFileSync('./sp1-fetch/input.txt', inputContent);

    console.log("Building SP1 program...");
    execSync('cargo prove build --packages sp1-fetch-program', {
      cwd: './sp1-fetch',
      stdio: 'inherit',
      env: { ...process.env, 
        RUST_LOG: 'info',
       }
    });

    // console.log("Generating Real SP1 proof...");
    // execSync('./target/release/sp1-fetch-script --prove', {
    //   cwd: './sp1-fetch',
    //   stdio: 'inherit',
    //   env: { ...process.env, 
    //     RUST_LOG: 'info' ,
    //   }
    // });

    const execFileAsync = promisify(execFile);


    // Only use this if you have Succint PROVE token
    try {
      console.log("Requesting Network Proof from Succinct...");
      
      // You MUST include 'cwd' so Rust finds input.txt and writes proof.bin in the right place
      const { stdout, stderr } = await execFileAsync('./target/release/sp1-fetch-script', ['--prove'], {
          cwd: './sp1-fetch', 
          env: { 
              ...process.env, 
              SP1_PROVER: 'network', 
              NETWORK_PRIVATE_KEY: process.env.NETWORK_PRIVATE_KEY,
              RUST_LOG: 'info' 
          }
      });

      if (stderr) {
            console.error("Rust stderr:", stderr);
        }

      console.log("Rust Output:", stdout);
  } catch (error: any) {
      // If it still says "Killed", it means your main.rs is still trying to prove locally
      console.error("Prover Error:", error);
  }

    // Else you use this to generate a proof instead
    // try {
    //     console.log("Generating SP1 proof...");
        
    //     // Command: ./target/release/sp1-fetch-script
    //     // Arguments: ["--execute"]
    //     const { stdout, stderr } = await execFileAsync('./target/release/sp1-fetch-script', ['--execute']);

    //     if (stderr) {
    //         console.error("Rust stderr:", stderr);
    //     }
    //     console.log("Rust stdout:", stdout);

    // } catch (error) {
    //     console.error("Execution failed:", error);
    // }

    const sp1Proof = fs.readFileSync('./sp1-fetch/proof.bin');
    console.log("Proof generated:", sp1Proof.length, "bytes");

    // NO publicOutputs read — use relayer-computed values (trusted for MVP)
    const jsonString = JSON.stringify(data);  // From fetch
    const jsonData = JSON.parse(jsonString);
    const price = jsonData.solana?.usd;  // Parsed price (u64 for commit)

    // URL hash (public input — relayer computes, ZK proves it was used)
    const encoder = new TextEncoder();
    const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(url));
    const urlHashBytes = new Uint8Array(hashBuffer);
    
    // Serialize public inputs as Borsh: [url_hash: [u8;32], price: u64]
    const publicInputsBuffer = Buffer.concat([
      Buffer.from(urlHashBytes),  // 32 bytes for hash
      // You might want to add price here too if needed
    ]);
    
    const hex_string: string = VKEY_HASH.startsWith('0x') ? VKEY_HASH.slice(2) : VKEY_HASH;
    
    // Convert hex string to 32-byte buffer
    if (hex_string.length !== 64) {
      throw new Error(`vkey_hash must be 32 bytes (64 hex chars), got ${hex_string.length}`);
    }
    const vkeyHashBuffer = Buffer.from(hex_string, 'hex');
    
    console.log("Relayer hash:", Array.from(urlHashBytes).slice(0, 8));  // Debug
    console.log("Relayer price:", price);
    console.log("Public Inputs Buffer:", publicInputsBuffer.toString('hex'));
    console.log("Vkey Hash Buffer:", vkeyHashBuffer.toString('hex'));

    // Step 3: Build instruction
    const provider = new AnchorProvider(CONNECTION, new Wallet(RELAYER_KEYPAIR), { commitment: 'confirmed' });
    // const programIdl = await Program.fetchIdl(PROGRAM_ID, provider);
    // if (!programIdl) throw new Error('IDL not found – run `anchor idl init`');
    console.log("→ Watching program:", PROGRAM_ID.toBase58());
    const program = new Program(anchorIdl as any, provider);
    console.log("Program loaded:", program.programId.toBase58());

    const requestAccount: any = await (program.account as any).dataRequest.fetch(requestId);
    console.log("Request Account:", requestAccount);

    const userKey = requestAccount.owner as PublicKey;
    console.log("User Key:", userKey);

    let requestSlot: number;
    const requestSlotBN = new BN(requestAccount.requestSlot);
    const requestIdBuffer = requestSlotBN.toArrayLike(Buffer, 'le', 8);

    const [dataRequest] = PublicKey.findProgramAddressSync(
      [Buffer.from('request'), userKey.toBuffer(), requestIdBuffer],
      program.programId
    );
    console.log("Data Request PDA:", dataRequest);

    const [response] = PublicKey.findProgramAddressSync(
      [Buffer.from('response'), dataRequest.toBuffer()],
      PROGRAM_ID
    );
    console.log("Response PDA:", response);

    // Debug: Log all instruction parameters
    console.log("Instruction Parameters:");
    console.log("  responseBytes length:", responseBytes.length, "type:", typeof responseBytes, "isBuffer:", Buffer.isBuffer(responseBytes));
    console.log("  sp1Proof length:", sp1Proof.length, "type:", typeof sp1Proof, "isBuffer:", Buffer.isBuffer(sp1Proof));
    console.log("  publicInputsBuffer length:", publicInputsBuffer.length, "hex:", publicInputsBuffer.toString('hex'));
    console.log("  vkeyHashBuffer length:", vkeyHashBuffer.length, "hex:", vkeyHashBuffer.toString('hex'));

    // Ensure all are Buffers (Anchor/Borsh will handle serialization)
    const responseBuffer = Buffer.isBuffer(responseBytes) ? responseBytes : Buffer.from(responseBytes);
    const proofBuffer = Buffer.isBuffer(sp1Proof) ? sp1Proof : Buffer.from(sp1Proof);
    
    const ix = await program.methods
      .fulfillRequest(responseBuffer, proofBuffer, publicInputsBuffer, vkeyHashBuffer.toString('hex'))
      .accounts({
        dataRequest,
        response,
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

    // tip tx (only if Jito is available)
    const tipAccount = await pickTipAccount(client);
    let tipVTx: VersionedTransaction | null = null;
    
    if (tipAccount) {
      const tipIx = SystemProgram.transfer({
        fromPubkey: RELAYER_KEYPAIR.publicKey,
        toPubkey: tipAccount,
        lamports: TIP_AMOUNT,
      });
      const tipMsg = new TransactionMessage({
        payerKey: RELAYER_KEYPAIR.publicKey,
        recentBlockhash: latest.blockhash,
        instructions: [tipIx],
      }).compileToV0Message();
      tipVTx = new VersionedTransaction(tipMsg);
      tipVTx.sign([RELAYER_KEYPAIR]);
    }

    // Step 5: Send via Jito searcher client (if available) or fallback to RPC
    if (client && tipVTx) {
      try {
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
          console.log("Could not send bundle! "+e);
        }

        client.onBundleResult(onSuccess, onError);
        
        const uuid = await client.sendBundle(txbundle);
        console.log('Bundle sent via Jito:', uuid);
      } catch (err) {
        console.warn("⚠️  Failed to send bundle via Jito:", err);
        console.log('Falling back to on-chain submit...');
        
        // Fallback: send the fulfill transaction directly
        const rawTx = fulfillVTx.serialize();
        const txSig = await CONNECTION.sendRawTransaction(rawTx, { skipPreflight: false, preflightCommitment: 'confirmed' });
        const latestBlockhash = await CONNECTION.getLatestBlockhash();
        await CONNECTION.confirmTransaction(
          { signature: txSig, ...latestBlockhash },
          'confirmed'
        );
        console.log('Fallback sig:', txSig);
      }
    } else {
      // Fallback: send the VersionedTransaction directly via RPC
      console.log('Jito unavailable, using RPC fallback...');
      const rawTx = fulfillVTx.serialize(); // serialize signed VersionedTransaction
      const txSig = await CONNECTION.sendRawTransaction(rawTx, { skipPreflight: false, preflightCommitment: 'confirmed' });

      // Wait for confirmation
      const latestBlockhash = await CONNECTION.getLatestBlockhash();
      await CONNECTION.confirmTransaction(
        { signature: txSig, ...latestBlockhash },
        'confirmed'
      );
      console.log('RPC fallback sig:', txSig);
    }

  } catch (err) {
    console.error('Process error:', err);
  }
}

// helper to pick tip account (unwraps Result, with fallback)
async function pickTipAccount(clientInstance: any): Promise<PublicKey | null> {
  if (!clientInstance) {
    console.warn("⚠️  Jito client not available, skipping tip");
    return null;
  }
  try {
    const tipAccountsResult = await clientInstance.getTipAccounts();
    if (!tipAccountsResult.ok) throw new Error(`Failed to fetch Jito tip accounts: ${tipAccountsResult.error}`);
    const tipAccounts = tipAccountsResult.value;
    if (!tipAccounts?.length) throw new Error('No tip accounts available');
    return new PublicKey(tipAccounts[Math.floor(Math.random() * tipAccounts.length)]);
  } catch (err) {
    console.warn("⚠️  Could not fetch tip accounts from Jito:", err);
    return null;
  }
}



console.log('Relayer listening on', RPC_URL);

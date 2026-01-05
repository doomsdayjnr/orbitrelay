# OrbitRelay Architecture

This document describes the architecture and design decisions behind OrbitRelay,
an experimental ZK-powered API verification system on Solana.

---

## System Overview

OrbitRelay consists of three main components:

1. On-chain request & verification program (Solana / Anchor)
2. Off-chain relayer & prover (TypeScript + SP1)
3. Client frontend (Next.js)

The system is event-driven and proof-based.

---

## Request Lifecycle

### 1. On-chain Request

A user submits an API request via the `request_data` instruction.

Stored on-chain:

- Request owner
- Target URL
- JSON path
- Request slot
- URL hash (SHA-256)
- Request status (Pending / Fulfilled)

An on-chain `DataRequested` event is emitted.

---

### 2. Event Observation (Relayer)

The relayer:

- Subscribes to program logs via WebSocket
- Parses Anchor events using the generated IDL
- Detects `DataRequested` events
- Extracts request metadata

This avoids polling and reduces RPC load.

---

### 3. Off-chain Fetch & Proof Generation

Upon receiving a request:

1. The relayer fetches the API response.
2. The response is serialized deterministically.
3. An SP1 ZK program is executed:
   - Uses the request URL as public input
   - Produces a Groth16 proof
4. Public inputs include:
   - URL hash
   - (Optional) derived response values

This proves that the relayer executed the expected logic using the requested URL.

---

### 4. Fulfillment Transaction

The relayer submits a `fulfill_request` instruction containing:

- API response bytes
- ZK proof
- Serialized public inputs
- Verification key hash

The transaction may be:

- Submitted via Jito bundles (preferred)
- Or sent directly via RPC as fallback

---

### 5. On-chain Verification

The Solana program performs:

1. URL hash validation:
   - Ensures the proof corresponds to the originally requested URL
2. ZK proof verification:
   - Uses SP1 Groth16 verifier
   - Verifies against a known verification key
3. State update:
   - Stores verified response
   - Marks request as fulfilled
   - Emits a `RequestFulfilled` event

---

## Trust Model

### What is Trusted

- The correctness of the ZK verifier
- The verification key used on-chain

### What is Not Trusted

- The relayer
- The API provider
- The transport layer

The relayer is **untrusted**; incorrect behavior results in invalid proofs.

---

## Design Trade-offs

### Why ZK?

- Removes trust in relayers
- Provides cryptographic guarantees
- Enables verifiable off-chain computation

### Why Off-chain Fetching?

- Solana programs cannot make HTTP requests
- Off-chain execution keeps on-chain costs low

### Current Limitations

- ZK proving is hardware-intensive
- Proof generation latency
- Limited public output parsing on-chain

---

## Future Directions

- Hardware-accelerated proving
- More expressive public outputs
- Request batching
- Improved on-chain parsing
- Integration with protocol consumers

---

## Status

OrbitRelay is an ongoing research project focused on exploring
trust-minimized API verification patterns on Solana.

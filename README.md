# 🛰️ OrbitRelay

### A Zero-Knowledge Digital Alibi for the Web

OrbitRelay is a trust-minimized, ZK-powered oracle protocol that bridges the gap between Web2 data and Solana. It provides a **"Verified Tick"** for any HTTPS API, proving that off-chain data is authentic without requiring you to trust the person who delivered it.

**Built for the Solana Privacy Hack 2026** — Category: Privacy Tooling & Infrastructure

---

## Motivation

Smart contracts often rely on external API data, which introduces trust assumptions
around oracles and relayers.

OrbitRelay explores an alternative approach:

- Off-chain data fetching
- Deterministic processing
- Cryptographic proof verification on-chain

The goal is not to replace existing oracle networks, but to investigate
**trust-minimized API verification patterns** on Solana.

---

## High-Level Flow

1. A user submits an API data request on-chain.
2. The request emits an on-chain event.
3. An off-chain relayer observes the event.
4. The relayer fetches the API response.
5. A ZK proof is generated attesting to correct execution.
6. The relayer submits the proof and response back on-chain.
7. The Solana program verifies the proof and stores the result.

---

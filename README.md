# 🛰️ OrbitRelay

## A Zero-Knowledge Digital Alibi for the Web

OrbitRelay is a trust-minimized, ZK-powered oracle protocol that bridges the gap between Web2 data and Solana. It provides a **"Verified Tick"** for any HTTPS API, proving that off-chain data is authentic without requiring you to trust the person who delivered it.

**Built for the Solana Privacy Hack 2026** — Category: Privacy Tooling & Infrastructure

---

## 🛠️ The Vision: Your Digital Alibi

Most oracles require you to trust a centralized middleman. OrbitRelay changes the game by using **Succinct SP1 (zkVM)** to generate a cryptographic "alibi" for your data:

✅ **Verified Origin**: Cryptographically proves that the data came from a specific, untampered HTTPS source (e.g., Coingecko, a bank API, or a weather station).

🛡️ **Untrusted Relayers**: The relayer can be anyone. If they try to "mess with" the data, the ZK proof will fail on-chain, and the Solana program will reject it.

🤫 **Selective Disclosure**: Enables privacy-preserving logic, such as proving a user's balance is above a threshold without revealing the exact amount to the blockchain.

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

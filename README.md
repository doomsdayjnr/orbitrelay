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

## 🚀 Key Features

**Universal Ingestion**: Works with any standard JSON API. No custom integration needed for new feeds.

**High Performance**: Optimized for the Succinct Prover Network, moving heavy ZK computation off-chain while maintaining Solana's speed.

**Instant Verification**: Leverages Solana’s low-cost compute to verify Groth16 proofs in a single transaction.

**Jito-Enabled**: The relayer uses Jito bundles to ensure proof fulfillment is fast and reliable.

---

## 🏗️ Technical Architecture

**OrbitRelay consists of three integrated layers:**

1. **On-Chain Program (Anchor/Rust)**: Manages data requests and uses the sp1-solana verifier to validate proofs.

2. **ZK-VM Guest (Rust)**: A specialized program running in SP1 that fetches, parses, and attests to the HTTPS response.

3. **Real-Time Relayer (TypeScript)**: Observes Solana events, manages the off-chain proving lifecycle, and submits the "Verified Tick" back on-chain.

---

## 🔧 Getting Started

**Prerequisites**

- [Solana CLI](https://docs.solana.com/cli/install-solana-cli-tools)
- [Anchor Framework](https://www.anchor-lang.com/docs/installation)
- [Succinct SP1 Toolchain](https://docs.succinct.xyz/docs/sp1/getting-started)

---

## Installation

### 1. Clone the repo:

```bash
git clone https://github.com/doomsdayjnr/orbitrelay.git
cd OrbitRelay
```

### 2. Deploy the Solana Program:

```bash
cd https-gateway
anchor build
anchor deploy
```

### 3. Run the Relayer (on Windows use WSL):

```bash
cd relayer
npm install
npm start
```

### 4. Run the Frontend:

```bash
cd frontend
npm install
npm run dev
```

---

## 📜 Trust Model

**Trusted:** The core ZK-VM circuit logic and the on-chain verification key.

**Untrusted:** The relayer, the transport layer, and any third-party infrastructure.

---

## 🗺️ Roadmap

[ ] **Mainnet Integration:** Moving from Solana Devnet to Mainnet.

[ ] **Hardware-Accelerated Proving:** Reducing latency for high-frequency price feeds.

[ ] **Private Data Feeds:** Support for authenticated APIs (API keys/OAuth) within the ZK-VM.

---

**Developed for the 2026 Solana Privacy Hack.** Investigating trust-minimized API verification patterns to make Solana the most secure home for real-world data.

---

## 📝 License

This project is licensed under the **Apache License 2.0**. See the [LICENSE](LICENSE) file for details.

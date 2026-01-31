// program/src/main.rs
#![no_main]

// CHANGE: Use sp1_zkvm instead of sp1_sdk
sp1_zkvm::entrypoint!(main);

// CHANGE: Import from sp1_zkvm::io instead of sp1_sdk::SP1StdinReader
use sp1_zkvm::io; 

use sha2::{Sha256, Digest};

pub fn main() {
    // 1. Read URL string (for hashing)
    let url = io::read::<String>(); 
    
    // 2. Read the FINAL u64 value (pre-parsed by the Host)
    // This value represents the price in cents (e.g., 14182)
    let price: u64 = io::read(); // <-- CHANGE: Directly read u64

    // 3. Hash URL (Core ZK logic remains the same)
    let mut hasher = Sha256::new();
    hasher.update(url.as_bytes());
    let url_hash = hasher.finalize();
    
    // 4. Commit the URL Hash
    io::commit_slice(&url_hash); 

    // 5. Commit the final price
    io::commit(&price);
}
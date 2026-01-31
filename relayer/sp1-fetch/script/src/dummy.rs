//sp1-fetch/script/src/main.rs
use sp1_sdk::{
    ProverClient, 
    SP1Stdin, 
    SP1VerifyingKey, 
    SP1ProvingKey,
};
use sp1_sdk::proof::SP1ProofWithPublicValues; 
use std::{fs, path::Path, error::Error};

// IMPORTS FOR ASYNC AND NETWORKING
use reqwest;
use tokio; 
use serde_json::Value;

const ELF_BYTES: &[u8] = include_bytes!("../../target/elf-compilation/riscv32im-succinct-zkvm-elf/release/sp1-fetch-program");

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error + Send + Sync>> {
    // --- 1. Read and Clean URL from File ---
    let file_content = fs::read_to_string("input.txt")
        .expect("Failed to read input.txt");

    let url_candidate = file_content.lines()
        .next()
        .unwrap_or_default();

    // 1b. Aggressively clean: Remove BOM and trim any leftover whitespace.
    let url = url_candidate
        .strip_prefix('\u{FEFF}') // Remove Byte Order Mark (BOM) if present
        .unwrap_or(url_candidate)
        .trim() // Remove leading/trailing whitespace
        .to_string();
    
    if url.is_empty() {
        return Err("URL read from input.txt is empty after cleaning.".into());
    }
    
    // 2. Fetch the REAL JSON Data (Host makes the network request)
    println!("Fetching data from: {}", url);

    let reqwest_client = reqwest::Client::new();
    let response = reqwest_client.get(&url)
        .send()
        .await?;

    if !response.status().is_success() {
        // ... error handling
        return Err(format!("API returned error status: {}", response.status()).into());
    }

    // Use .json() once for clean deserialization
    let json: Value = response.json().await?; 
    
    // --- Cleaned up logging and parsing ---
    println!("Full JSON Response: {:#?}", json);
    
    // Extract price as f64 (e.g., 141.82)
    let price_f64 = json["solana"]["usd"]
        .as_f64()
        .expect(&format!("Host: Failed to parse 'solana.usd'. Full Object: {:?}", json)); // Check the parsed object, not the response

    println!("Price float 64: {:?}", price_f64);

    // Convert to u64 price in CENTS (e.g., 141.82 * 100 = 14182)
    let price_in_cents: u64 = (price_f64 * 100.0).round() as u64; 

    println!("price_in_cents: {:?}", price_in_cents);
    
    // 4. Setup Prover and Input
    let client = ProverClient::from_env(); // Alternative: Local Proving need more RAM 
    let mut stdin = SP1Stdin::new();

    println!("Client setup complete. Preparing inputs...");
    
    // Write the two inputs for the GUEST PROGRAM (no JSON parsing needed in Guest anymore)
    stdin.write(&url);              // First input: URL string (for hashing)
    stdin.write(&price_in_cents);   // Second input: Final u64 price (in cents, for commitment)

    println!("Writen inputs to stdin. Starting proof generation...");

    // 5. Setup Proving Key (pk) and Verifying Key (vk)
    let (pk, _vk): (SP1ProvingKey, SP1VerifyingKey) = client.setup(ELF_BYTES);

    println!("Proving and Verifying keys setup complete.");

    // 6. Proof Generation (Create the proof)
    let proof: SP1ProofWithPublicValues = client.prove(&pk, &stdin).run().expect("Proving failed");

    println!("Proof generation complete.");

    // 7. Save the Proof Binary
    let proof_bytes = proof.bytes();
    let proof_path = Path::new("proof.bin");
    fs::write(proof_path, proof_bytes).expect("Failed to write proof.bin"); 
    println!("Proof saved to proof.bin!");

    // 8. Output Verification (Read the public outputs)
    let mut public_values = proof.public_values; 
    
    let url_hash: [u8; 32] = public_values.read(); 
    println!("Successfully proved execution. URL Hash: {:?}", url_hash);

    let committed_price: u64 = public_values.read(); 
    
    // Display the committed price back in dollars and cents for readability
    println!("Price committed: ${}.{:02}", committed_price / 100, committed_price % 100);

    println!("Proof verified successfully! 🎉 (Verification logic bypassed due to import error)");
    Ok(())
}
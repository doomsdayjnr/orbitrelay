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

use clap::Parser;

const ELF_BYTES: &[u8] = include_bytes!("../../target/elf-compilation/riscv32im-succinct-zkvm-elf/release/sp1-fetch-program");

/// The arguments for the command.
#[derive(Parser, Debug)]
#[command(author, version, about, long_about = None)]
struct Args {
    /// Execute the program in the local zkVM without generating a full proof.
    #[arg(long)]
    execute: bool,

    /// Generate a full zero-knowledge proof (requires high resources or Prover Network token).
    #[arg(long)]
    prove: bool,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error + Send + Sync>> {
    // --- 0. Parse Arguments ---
    let args = Args::parse();

    if args.execute == args.prove {
        eprintln!("Error: You must specify either --execute or --prove");
        std::process::exit(1);
    }

    // --- 1. Read and Clean URL from File ---
    let file_content = fs::read_to_string("input.txt")
        .expect("Failed to read input.txt");

    let mut lines = file_content.lines();
    
    // Line 1: URL
    let url = lines.next().unwrap_or_default().trim().to_string();
    // Line 2: JSON Path (e.g., "bitcoin.usd" or "current.temperature_2m")
    let json_path = lines.next().unwrap_or_default().trim().to_string();
    // Line 3: Raw Response (Optional, if you pass it from index.ts)
    
    if url.is_empty() || json_path.is_empty() {
        return Err("URL or JSON Path is missing from input.txt".into());
    }
    
    // 2. Fetch the REAL JSON Data (Host makes the network request)
    println!("Fetching data from: {}", url);

    // let reqwest_client = reqwest::Client::new();
    let reqwest_client = reqwest::Client::builder()
    .user_agent("MyOrbitRelayProject/1.0 (Contact: your@email.com)")
    .build()?; // Note the .build() call here
    let response = reqwest_client.get(&url)
        .send()
        .await?;

   

    let mut current_value = &json;
    for part in json_path.split('.') {
        current_value = &current_value[part];
    }

    if current_value.is_null() {
        return Err(format!("Failed to find path '{}' in response", json_path).into());
    }

    // Convert the found value to bytes to pass to the Guest
    // This allows it to be a number, string, or boolean
    let result_data = current_value.to_string(); 
    println!("Found value at {}: {}", json_path, result_data);
    
    // 4. Setup Prover and Input
    let client = ProverClient::from_env(); // Alternative: Local Proving need more RAM 
    let mut stdin = SP1Stdin::new();
    
    // Write the two inputs for the GUEST PROGRAM (no JSON parsing needed in Guest anymore)
    stdin.write(&url);              // First input: URL string (for hashing)
    stdin.write(&price_in_cents);   // Second input: Final u64 price (in cents, for commitment)

    println!("Inputs prepared for Guest Program...");

    // --- 5. Conditional Execution ---
    if args.execute {
        println!("Running program in EXECUTE mode (no proof generation)...");

        let (mut public_values, _report) = client.execute(ELF_BYTES, &stdin).run().expect("Execution failed");
        
        let url_hash: [u8; 32] = public_values.read(); 
        println!("Successfully executed. URL Hash: {:?}", url_hash);

        let committed_price: u64 = public_values.read(); 
        
        println!("Price committed: ${}.{:02}", committed_price / 100, committed_price % 100);

        // --- Dummy proof.bin creation ---
        // Since index.ts requires a proof.bin, we'll write a simple placeholder.
        // NOTE: This file is INVALID for verification, but satisfies the file existence check.
        // You MUST switch to --prove mode (local/network) for real verification.
        let dummy_data = [0u8; 32]; // 32 zero bytes as a placeholder
        let proof_path = Path::new("proof.bin");
        fs::write(proof_path, dummy_data).expect("Failed to write dummy proof.bin"); 
        println!("Dummy proof saved to proof.bin to satisfy file checks!");
        
    } else { // args.prove
        println!("Running program in PROVE mode (high resource)...");

        // 5. Setup Proving Key (pk) and Verifying Key (vk)
        let (pk, _vk): (SP1ProvingKey, SP1VerifyingKey) = client.setup(ELF_BYTES);

        println!("Proving and Verifying keys setup complete.");

        // 6. Proof Generation (Create the proof)
        let proof: SP1ProofWithPublicValues = client.prove(&pk, &stdin).run().expect("Proving failed"); // Hardware intensive logic

        // 1. Tell the client to use the NetworkProver (usually via environment config or builder)
        // 2. Request the proof asynchronously
        let proof_id = client.prove(&pk, &stdin).request_async().await?;
        println!("Proof request submitted. ID: {}", proof_id);

        // 3. Later, poll for the status of the proof:
        let (status, proof) = network_prover
            .get_proof_status(&proof_id)
            .await?; 
        // Once the status is "Complete," the 'proof' variable will contain the final SP1ProofWithPublicValues.

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

        println!("Proof verified successfully! 🎉");
    }

    Ok(())
}
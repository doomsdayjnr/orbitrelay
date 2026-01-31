// sp1-fetch/script/src/bin/vkey.rs
use sp1_sdk::{
    ProverClient, 
    SP1ProvingKey, 
    SP1VerifyingKey, 
};

use sp1_sdk::HashableKey; // <--- ADD THIS
// use sp1_sdk::utils::SP1Key; // <--- ADD THIS

// Use the same ELF path as defined in your main.rs
const ELF_BYTES: &[u8] = include_bytes!(
    "../../../target/elf-compilation/riscv32im-succinct-zkvm-elf/release/sp1-fetch-program"
);

fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("Starting key generation...");

    // 1. Initialize the Prover Client
    let client = ProverClient::new();

    // 2. Setup the Proving Key (pk) and Verifying Key (vk)
    // This is the part that replaced `cargo prove --setup`
    let (pk, vk) = client.setup(ELF_BYTES);

    // // 3. Save the keys (optional, but good practice)
    // pk.save("pk.bin")?;
    // vk.save("vk.bin")?;

    // 4. Print the VKEY Hash in the format needed for Solana contracts
    // This is the 32-byte hash (used as the `image_id` / `program_id` for verification)
    println!("\n✅ Key generation complete. Keys saved to pk.bin and vk.bin");
    println!("===============================================================");
    println!("    VKEY HASH (PROGRAM_ID): {}", vk.bytes32());
    println!("===============================================================");

    Ok(())
}
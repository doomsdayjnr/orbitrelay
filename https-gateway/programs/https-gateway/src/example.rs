// SPDX-License-Identifier: Apache-2.0

use anchor_lang::prelude::*;
use anchor_lang::solana_program::hash::hash;  // For URL hashing
use anchor_lang::solana_program::system_instruction;
use sp1_solana::verify_proof;  // Real SP1 Groth16 verifier
use borsh::BorshDeserialize;

use light_sdk::{
    account::LightAccount,
    address::v2::derive_address,
    cpi::{v2::CpiAccounts, CpiSigner},
    derive_light_cpi_signer,
    instruction::{PackedAddressTreeInfo, ValidityProof},
    LightDiscriminator, LightHasher,
};
use light_sdk::constants::ADDRESS_TREE_V2;
use light_sdk::cpi::{v2::LightSystemProgramCpi, InvokeLightSystemProgram, LightCpiInstruction};


declare_id!("9Y14JQxhwyHVrvMJeK3UedpprfJmv1piTsAf3ZWWPkiG"); 

pub const LIGHT_CPI_SIGNER: CpiSigner =
    derive_light_cpi_signer!("9Y14JQxhwyHVrvMJeK3UedpprfJmv1piTsAf3ZWWPkiG");

#[program]
pub mod https_gateway {
    use super::*;

    /// User calls this to request any HTTPS API
    pub fn request_data(
        ctx: Context<RequestData>,
        url: String,
        json_path: String,  // e.g., "solana.usd" for Coingecko
        request_slot: u64,
        fee_lamports: u64,
    ) -> Result<()> {
        msg!("DEBUG: request_data called for user {}", ctx.accounts.user.key());
        msg!("DEBUG: request PDA = {}", ctx.accounts.data_request.key());
        require!(url.len() <= 280, ErrorCode::UrlTooLong);
        require!(json_path.len() <= 100, ErrorCode::PathTooLong);
        require!(fee_lamports > 0, ErrorCode::InsufficientFee);

        anchor_lang::solana_program::program::invoke(
            &system_instruction::transfer(
                ctx.accounts.user.key,
                &ctx.accounts.escrow.key(),
                fee_lamports,
            ),
            &[
                ctx.accounts.user.to_account_info(),
                ctx.accounts.escrow.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
        )?;

        let request_id = ctx.accounts.data_request.key();
        let request = &mut ctx.accounts.data_request;
        request.owner = ctx.accounts.user.key();
        request.url = url.clone();
        request.json_path = json_path;
        request.status = RequestStatus::Pending;
        request.request_slot = request_slot;
        // Pre-compute URL hash for public input verification
        request.url_hash = hash(&url.as_bytes()).to_bytes();

        emit!(DataRequested {
            request_id,
            url: request.url.clone(),
        });

        msg!("DEBUG: Event emitted!");

        Ok(())
    }

    /// Off-chain relayer calls this with SP1 proof + response
    pub fn fulfill_request<'info>(
        ctx: Context<FulfillRequest>,
        proof: ValidityProof,           // Light Protocol Validity Proof
        address_tree_info: PackedAddressTreeInfo, // Merkle Tree info
        output_state_tree_index: u8,    // Index for the new account
        response_bytes: Vec<u8>,
        sp1_proof: Vec<u8>,  // SP1 Groth16 proof (from relayer)
        sp1_public_inputs: Vec<u8>,  // Serialized public inputs (e.g., Borsh: url_hash + price)
        vkey_hash: String,  // Hex string like "0083e8e370d7f0d1c463337f76c9a60b62ad7cc54c89329107c92c1e62097872"
    ) -> Result<()> {
        let request = &mut ctx.accounts.data_request;
        println!("DEBUG: request status {}", request.status);
        require_eq!(request.status, RequestStatus::Pending, ErrorCode::AlreadyFulfilled);

        // Step 1: Deserialize and check public inputs match stored URL hash
        // (Relayer serializes: [url_hash: [u8;32], price: u64] or similar)
        let mut reader = &sp1_public_inputs[..];
        let deserialized_hash: [u8; 32] = BorshDeserialize::deserialize(&mut reader)
            .map_err(|_| error!(ErrorCode::InvalidPublicInputs))?;

        if deserialized_hash != request.url_hash {
            return err!(ErrorCode::MismatchedUrlHash);
        }
        

        // Step 2: Verify the SP1 ZK proof using Succinct's Groth16 verifier
        let vk = sp1_solana::GROTH16_VK_5_0_0_BYTES;
        // Alternative option let vk = *sp1_solana::GROTH16_VK_BYTES;

        verify_proof(
            &sp1_proof,
            &sp1_public_inputs,
            &vkey_hash,
            vk,
        ).map_err(|_| ErrorCode::InvalidProof)?;

        // Step 3:  Light Protocol Compression ---
        // Instead of initializing a PDA, we "output" a compressed account.
        // This effectively 'zips' the 4KB data into the Merkle Tree.
        
        // 2a. Prepare the CPI accounts wrapper
        let light_cpi_accounts = CpiAccounts::new(
            ctx.accounts.relayer.as_ref(), // The relayer pays for the state update
            ctx.remaining_accounts,
            crate::LIGHT_CPI_SIGNER,
        );

        // 2b. Verify address tree
        let address_tree_pubkey = address_tree_info
            .get_tree_pubkey(&light_cpi_accounts)
            .map_err(|_| ErrorCode::AccountNotEnoughKeys)?;

        if address_tree_pubkey.to_bytes() != ADDRESS_TREE_V2 {
            msg!("Invalid address tree");
            return err!(ErrorCode::InvalidAccountData);
        }

        // 2c. Derive the address for the new compressed account
        // We use the request ID as a seed to link the response to the request
        let (address, address_seed) = derive_address(
            &[b"response", request.key().as_ref()], 
            &address_tree_pubkey,
            &crate::ID,
        );

        let new_address_params =
            address_tree_info.into_new_address_params_assigned_packed(address_seed, Some(0));

        // 2d. Create the LightAccount wrapper
        let mut response_account = LightAccount::<DataResponse>::new_init(
            &crate::ID,
            Some(address),
            output_state_tree_index,
        );

        // 2e. Set the data
        response_account.owner = ctx.accounts.relayer.key(); // Or request.owner if you prefer
        response_account.request = request.key();
        response_account.data = response_bytes.clone();
        response_account.fulfilled_slot = Clock::get()?.slot;
        response_account.relayer = ctx.accounts.relayer.key();

        // 2f. Execute the CPI to the Light System Program
        LightSystemProgramCpi::new_cpi(LIGHT_CPI_SIGNER, proof)
            .with_light_account(response_account)?
            .with_new_addresses(&[new_address_params])
            .invoke(light_cpi_accounts)?;

        request.status = RequestStatus::Fulfilled;

        emit!(RequestFulfilled {
            request_id: request.key(),
            data_length: response_bytes.len() as u32,
        });

        Ok(())
    }
}

// NEW: Updated struct for v2 - uses LightHasher/LightDiscriminator
#[derive(Debug, Clone, Default, LightDiscriminator, LightHasher, AnchorSerialize, AnchorDeserialize)]
pub struct DataResponse {
    #[hash] // Marks this field as part of the unique identity hash
    pub request: Pubkey,
    #[hash]
    pub data: Vec<u8>, 
    pub fulfilled_slot: u64,
    #[hash]
    pub relayer: Pubkey,
    #[hash]
    pub owner: Pubkey, // Added owner field for LightAccount compatibility
}

#[derive(Accounts)]
#[instruction(url: String, json_path: String, request_slot: u64)]
pub struct RequestData<'info> {
    #[account(
        init,
        payer = user,
        space = 8 + DataRequest::INIT_SPACE,
        seeds = [b"request", user.key().as_ref(), &request_slot.to_le_bytes()],
        bump
    )]
    pub data_request: Account<'info, DataRequest>,

    #[account(
        init,
        payer = user,
        space = 8 + 32,
        seeds = [b"escrow", data_request.key().as_ref()],
        bump
    )]
    pub escrow: Account<'info, Escrow>,

    #[account(mut)]
    pub user: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct FulfillRequest<'info> {
    #[account(mut)]
    pub data_request: Account<'info, DataRequest>,

    #[account(
        mut,
        seeds = [b"escrow", data_request.key().as_ref()],
        bump
    )]
    pub escrow: Account<'info, Escrow>,

    /// CHECK: relayer only signs, does not pay
    #[account(mut)]
    pub relayer: Signer<'info>,  // Your off-chain bot
    
    pub system_program: Program<'info, System>,
}

// ==================== DATA STRUCTURES ====================

#[account]
pub struct DataRequest {
    pub owner: Pubkey,
    pub url: String,
    pub json_path: String,
    pub status: RequestStatus,
    pub request_slot: u64,
    pub url_hash: [u8; 32],  // Hash for public input verification
    pub bump: u8,
}


#[account]
pub struct Escrow {
    pub request: Pubkey,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq)]
pub enum RequestStatus {
    Pending,
    Fulfilled,
}

impl std::fmt::Display for RequestStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            RequestStatus::Pending => write!(f, "Pending"),
            RequestStatus::Fulfilled => write!(f, "Fulfilled"),
        }
    }
}

impl Space for DataRequest {
    const INIT_SPACE: usize = 32 +               // owner
        4 + 280 +                                 // url (max 280 chars)
        4 + 100 +                                 // json_path
        1 +                                       // status enum
        8 +                                       // slot
        32 +                                      // url_hash
        1;                                        // bump
}

impl Space for DataResponse {
    const INIT_SPACE: usize = 32 +                // request pubkey
        4 + 4000 +                                // data (up to ~4KB JSON)
        8 +                                       // slot
        32;                                       // relayer
}

// ==================== EVENTS ====================

#[event]
pub struct DataRequested {
    pub request_id: Pubkey,
    pub url: String,
}

#[event]
pub struct RequestFulfilled {
    pub request_id: Pubkey,
    pub data_length: u32,
}

// ==================== ERRORS ====================

#[error_code]
pub enum ErrorCode {
    #[msg("URL too long, max 280 chars")]
    UrlTooLong,
    #[msg("JSON path too long")]
    PathTooLong,
    #[msg("Request already fulfilled")]
    AlreadyFulfilled,
    #[msg("Invalid ZK proof")]
    InvalidProof,
    #[msg("Public inputs do not match the requested URL hash")] 
    MismatchedUrlHash,
    #[msg("Failed to deserialize public inputs")]
    InvalidPublicInputs,
    #[msg("Insufficient fee provided")]
    InsufficientFee,
    #[msg("Not enough account keys provided for Light CPI")]
    AccountNotEnoughKeys,
    #[msg("Invalid account data encountered")]
    InvalidAccountData,
}
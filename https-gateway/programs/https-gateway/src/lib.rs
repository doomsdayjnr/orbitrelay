// SPDX-License-Identifier: Apache-2.0

use anchor_lang::prelude::*;
use anchor_lang::solana_program::hash::hash;  // For URL hashing
use sp1_solana::verify_proof;  // Real SP1 Groth16 verifier
use borsh::BorshDeserialize;

declare_id!("9Y14JQxhwyHVrvMJeK3UedpprfJmv1piTsAf3ZWWPkiG"); 

#[program]
pub mod https_gateway {
    use super::*;

    /// User calls this to request any HTTPS API
    pub fn request_data(
        ctx: Context<RequestData>,
        url: String,
        json_path: String,  // e.g., "solana.usd" for Coingecko
        request_slot: u64,
    ) -> Result<()> {
        msg!("DEBUG: request_data called for user {}", ctx.accounts.user.key());
        msg!("DEBUG: request PDA = {}", ctx.accounts.data_request.key());
        require!(url.len() <= 280, ErrorCode::UrlTooLong);
        require!(json_path.len() <= 100, ErrorCode::PathTooLong);

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
    pub fn fulfill_request(
        ctx: Context<FulfillRequest>,
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
        // Optional: Deserialize price or other outputs if you want to store/use them on-chain

        // Step 2: Verify the SP1 ZK proof using Succinct's Groth16 verifier
        let vk = sp1_solana::GROTH16_VK_5_0_0_BYTES;
        // let vk = *sp1_solana::GROTH16_VK_BYTES;
        verify_proof(
            &sp1_proof,
            &sp1_public_inputs,
            &vkey_hash,
            vk,
        ).map_err(|_| ErrorCode::InvalidProof)?;

        // Step 3: Store the verified response (same as yours)
        let response = &mut ctx.accounts.response;
        response.request = request.key();
        response.data = response_bytes;
        response.fulfilled_slot = Clock::get()?.slot;
        response.relayer = ctx.accounts.relayer.key();

        request.status = RequestStatus::Fulfilled;

        emit!(RequestFulfilled {
            request_id: request.key(),
            data_length: response.data.len() as u32,
        });

        Ok(())
    }
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

    #[account(mut)]
    pub user: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct FulfillRequest<'info> {
    #[account(mut)]
    pub data_request: Account<'info, DataRequest>,

    #[account(
        init,
        payer = relayer,
        space = 8 + DataResponse::INIT_SPACE,
        seeds = [b"response", data_request.key().as_ref()],
        bump
    )]
    pub response: Account<'info, DataResponse>,

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
pub struct DataResponse {
    pub request: Pubkey,
    pub data: Vec<u8>,        // Raw JSON bytes (verified!)
    pub fulfilled_slot: u64,
    pub relayer: Pubkey,
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
}
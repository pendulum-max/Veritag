#![no_std]

pub mod events;
pub mod merkle;
pub mod storage;
pub mod types;

use soroban_sdk::{contract, contractimpl, Address, Bytes, BytesN, Env, String, Vec};

use crate::events::{
    BatchCommitted, BatchFrozen, BatchRecalled, BatchUnfrozen, BrandActionExecuted,
    BrandActionProposed, BrandRegistered, BrandVerified, ClaimFiled, ClaimResolved,
    DuplicateAttempt, ServiceCenterRegistered, TransferCancelled, TransferOffered, UnitActivated,
    UnitFlagged, UnitRetired, UnitTransferred, WarrantyExtended,
};
use crate::types::{
    Batch, BatchStatus, Brand, BrandAction, BrandActionProposal, BrandAdminConfig, Claim,
    ClaimOutcome, Config, RecallInfo, RegistryError, TransferOffer, Unit, UnitRetirement,
    UnitStatus, UnitView, VerifyResult, VerifyStatus, DEFAULT_MAX_CLAIMS_PER_UNIT,
    MAX_WARRANTY_MONTHS, SECONDS_PER_MONTH,
};

const MAX_DOMAIN_LEN: u32 = 253;

#[contract]
pub struct VeritagRegistry;

#[contractimpl]
impl VeritagRegistry {
    // -------------------------------------------------------------------------
    // Registry Administration
    // -------------------------------------------------------------------------

    /// Initializes the global registry configuration with an admin account.
    pub fn init(env: Env, admin: Address) -> Result<(), RegistryError> {
        if storage::has_config(&env) {
            return Err(RegistryError::AlreadyInitialized);
        }
        admin.require_auth();

        let config = Config {
            admin,
            max_claims_per_unit: DEFAULT_MAX_CLAIMS_PER_UNIT,
        };
        storage::set_config(&env, &config);
        Ok(())
    }

    /// Updates the global per-unit warranty claim limit (registry admin only).
    pub fn set_max_claims_per_unit(env: Env, max_claims: u32) -> Result<(), RegistryError> {
        if max_claims == 0 {
            return Err(RegistryError::InvalidInput);
        }
        let mut config = storage::get_config(&env).ok_or(RegistryError::NotInitialized)?;
        config.admin.require_auth();

        config.max_claims_per_unit = max_claims;
        storage::set_config(&env, &config);
        Ok(())
    }

    /// Rotates the registry admin account (registry admin + new admin auth).
    pub fn rotate_admin(env: Env, new_admin: Address) -> Result<(), RegistryError> {
        let mut config = storage::get_config(&env).ok_or(RegistryError::NotInitialized)?;
        config.admin.require_auth();
        new_admin.require_auth();

        config.admin = new_admin;
        storage::set_config(&env, &config);
        Ok(())
    }

    /// Registers a brand with its domain name (`stellar.toml` verification pending).
    pub fn register_brand(env: Env, brand: Address, domain: String) -> Result<(), RegistryError> {
        if !storage::has_config(&env) {
            return Err(RegistryError::NotInitialized);
        }
        if domain.is_empty() || domain.len() > MAX_DOMAIN_LEN {
            return Err(RegistryError::InvalidInput);
        }
        brand.require_auth();

        if storage::get_brand(&env, &brand).is_some() {
            return Err(RegistryError::BrandAlreadyExists);
        }

        let record = Brand {
            admin: brand.clone(),
            domain: domain.clone(),
            verified: false,
            registered_at: env.ledger().timestamp(),
            admin_config: BrandAdminConfig {
                admins: Vec::from_array(&env, [brand.clone()]),
                threshold: 1,
            },
            admin_generation: 0,
            next_action_id: 0,
        };
        storage::set_brand(&env, &brand, &record);
        storage::extend_instance_ttl(&env);

        BrandRegistered { brand, domain }.publish(&env);
        Ok(())
    }

    /// Marks a registered brand as verified after off-chain `stellar.toml` domain validation.
    pub fn verify_brand(env: Env, brand: Address) -> Result<(), RegistryError> {
        let config = storage::get_config(&env).ok_or(RegistryError::NotInitialized)?;
        config.admin.require_auth();

        let mut record = storage::get_brand(&env, &brand).ok_or(RegistryError::BrandNotFound)?;
        record.verified = true;
        storage::set_brand(&env, &brand, &record);
        storage::extend_instance_ttl(&env);

        BrandVerified { brand }.publish(&env);
        Ok(())
    }

    /// Rotates the signing admin key for an existing brand while keeping its canonical brand address.
    pub fn rotate_brand_admin(
        env: Env,
        brand: Address,
        new_admin: Address,
    ) -> Result<(), RegistryError> {
        let mut record = storage::get_brand(&env, &brand).ok_or(RegistryError::BrandNotFound)?;
        Self::require_single_brand_admin(&record)?;
        new_admin.require_auth();

        Self::replace_brand_admins(
            &env,
            &brand,
            &mut record,
            BrandAdminConfig {
                admins: Vec::from_array(&env, [new_admin]),
                threshold: 1,
            },
        )?;
        Ok(())
    }

    /// Configures initial threshold governance; later changes require an approved action.
    pub fn configure_brand_admins(
        env: Env,
        brand: Address,
        config: BrandAdminConfig,
    ) -> Result<(), RegistryError> {
        Self::validate_admin_config(&config)?;
        let mut record = storage::get_brand(&env, &brand).ok_or(RegistryError::BrandNotFound)?;
        Self::require_single_brand_admin(&record)?;
        Self::replace_brand_admins(&env, &brand, &mut record, config)
    }

    /// Proposes a sensitive action and records the authenticated proposer's first approval.
    pub fn propose_brand_action(
        env: Env,
        caller: Address,
        brand: Address,
        action: BrandAction,
    ) -> Result<u32, RegistryError> {
        let mut record = storage::get_brand(&env, &brand).ok_or(RegistryError::BrandNotFound)?;
        Self::require_brand_voter(&record, &caller)?;
        Self::validate_brand_action(&env, &brand, &record, &action)?;
        let proposal_id = record.next_action_id;
        record.next_action_id = proposal_id
            .checked_add(1)
            .ok_or(RegistryError::InvalidInput)?;
        storage::set_brand(&env, &brand, &record);
        let mut proposal = BrandActionProposal {
            action: action.clone(),
            caller: caller.clone(),
            approvals: Vec::from_array(&env, [caller.clone()]),
            admin_generation: record.admin_generation,
            executed: false,
        };
        BrandActionProposed {
            brand: brand.clone(),
            proposal_id,
            caller,
            action,
        }
        .publish(&env);
        if record.admin_config.threshold == 1 {
            Self::execute_brand_action(&env, &brand, proposal_id, &mut record, &mut proposal)?;
        }
        storage::set_brand_action(&env, &brand, proposal_id, &proposal);
        storage::extend_instance_ttl(&env);
        Ok(proposal_id)
    }

    /// Adds one authenticated admin approval and executes only when the threshold is met.
    pub fn approve_brand_action(
        env: Env,
        caller: Address,
        brand: Address,
        proposal_id: u32,
    ) -> Result<bool, RegistryError> {
        let mut record = storage::get_brand(&env, &brand).ok_or(RegistryError::BrandNotFound)?;
        Self::require_brand_voter(&record, &caller)?;
        let mut proposal = storage::get_brand_action(&env, &brand, proposal_id)
            .ok_or(RegistryError::InvalidInput)?;
        if proposal.executed
            || proposal.admin_generation != record.admin_generation
            || proposal.approvals.contains(&caller)
        {
            return Err(RegistryError::NotAuthorized);
        }
        proposal.approvals.push_back(caller);
        if proposal.approvals.len() >= record.admin_config.threshold {
            Self::validate_brand_action(&env, &brand, &record, &proposal.action)?;
            Self::execute_brand_action(&env, &brand, proposal_id, &mut record, &mut proposal)?;
        }
        storage::set_brand(&env, &brand, &record);
        storage::set_brand_action(&env, &brand, proposal_id, &proposal);
        storage::extend_instance_ttl(&env);
        Ok(proposal.executed)
    }

    pub fn get_brand_admin_config(env: Env, brand: Address) -> Option<BrandAdminConfig> {
        storage::get_brand(&env, &brand).map(|record| record.admin_config)
    }

    pub fn get_brand_action(
        env: Env,
        brand: Address,
        proposal_id: u32,
    ) -> Option<BrandActionProposal> {
        storage::get_brand_action(&env, &brand, proposal_id)
    }

    /// Authorizes a service center, defaulting new centers to tier 3 for compatibility.
    /// Reauthorization preserves its existing tier.
    pub fn register_service_center(
        env: Env,
        brand: Address,
        service_center: Address,
    ) -> Result<(), RegistryError> {
        let brand_record = Self::require_verified_brand(&env, &brand)?;
        Self::require_single_brand_admin(&brand_record)?;
        Self::register_service_center_internal(&env, brand, service_center)
    }

    fn register_service_center_internal(
        env: &Env,
        brand: Address,
        service_center: Address,
    ) -> Result<(), RegistryError> {
        let mut record =
            storage::get_service_center(env, &brand, &service_center).unwrap_or(ServiceCenter {
                tier: 3,
                active: true,
            });
        record.active = true;
        storage::set_service_center(env, &brand, &service_center, &record);
        ServiceCenterRegistered {
            brand,
            service_center,
            authorized: true,
        }
        .publish(env);
        Ok(())
    }

    /// Revokes a service center's authorization for a brand.
    pub fn revoke_service_center(
        env: Env,
        brand: Address,
        service_center: Address,
    ) -> Result<(), RegistryError> {
        let brand_record = storage::get_brand(&env, &brand).ok_or(RegistryError::BrandNotFound)?;
        Self::require_single_brand_admin(&brand_record)?;
        Self::revoke_service_center_internal(&env, brand, service_center)
    }

    fn revoke_service_center_internal(
        env: &Env,
        brand: Address,
        service_center: Address,
    ) -> Result<(), RegistryError> {
        let mut record = storage::get_service_center(env, &brand, &service_center)
            .ok_or(RegistryError::ServiceCenterNotAuthorized)?;
        record.active = false;
        storage::set_service_center(env, &brand, &service_center, &record);
        ServiceCenterRevoked {
            brand: brand.clone(),
            service_center: service_center.clone(),
        }
        .publish(env);
        // Preserve the existing authorization event for indexer compatibility.
        ServiceCenterRegistered {
            brand,
            service_center,
            authorized: false,
        }
        .publish(env);
        Ok(())
    }

    /// Updates accreditation without reactivating a revoked center (brand admin only).
    pub fn update_service_center_tier(
        env: Env,
        brand: Address,
        service_center: Address,
        new_tier: u32,
    ) -> Result<(), RegistryError> {
        if !(1..=3).contains(&new_tier) {
            return Err(RegistryError::InvalidInput);
        }
        let brand_record = storage::get_brand(&env, &brand).ok_or(RegistryError::BrandNotFound)?;
        Self::require_single_brand_admin(&brand_record)?;
        Self::update_service_center_tier_internal(&env, brand, service_center, new_tier)
    }

    fn update_service_center_tier_internal(
        env: &Env,
        brand: Address,
        service_center: Address,
        new_tier: u32,
    ) -> Result<(), RegistryError> {
        if !(1..=3).contains(&new_tier) {
            return Err(RegistryError::InvalidInput);
        }
        let mut record = storage::get_service_center(env, &brand, &service_center)
            .ok_or(RegistryError::ServiceCenterNotAuthorized)?;
        record.tier = new_tier;
        storage::set_service_center(env, &brand, &service_center, &record);
        ServiceCenterTierUpdated {
            brand,
            service_center,
            new_tier,
        }
        .publish(env);
        Ok(())
    }

    // -------------------------------------------------------------------------
    // Production Batches
    // -------------------------------------------------------------------------

    /// Commits a production batch Merkle root for a verified brand.
    // Preserve both optional expiration and metadata from the merged batch features.
    #[allow(clippy::too_many_arguments)]
    pub fn commit_batch(
        env: Env,
        brand: Address,
        batch_id: BytesN<32>,
        merkle_root: BytesN<32>,
        warranty_months: u32,
        product_meta_hash: BytesN<32>,
        unit_count: u64,
        expires_at: Option<u64>,
        metadata_cid: Option<BytesN<32>>,
    ) -> Result<(), RegistryError> {
        if unit_count == 0 || expires_at.is_some_and(|expiry| expiry <= env.ledger().timestamp()) {
            return Err(RegistryError::InvalidInput);
        }
        let brand_record = Self::require_verified_brand(&env, &brand)?;
        brand_record.admin.require_auth();

        if storage::has_batch(&env, &brand, &batch_id) {
            return Err(RegistryError::BatchExists);
        }

        let batch = Batch {
            brand: brand.clone(),
            merkle_root: merkle_root.clone(),
            warranty_months,
            max_transfers: None,
            max_claims: None,
            product_meta_hash,
            metadata_cid: metadata_cid.clone(),
            unit_count,
            created_at: env.ledger().timestamp(),
            recalled: false,
            frozen: false,
            expires_at,
            status: BatchStatus::Active,
        };
        storage::set_batch(&env, &brand, &batch_id, &batch);
        storage::extend_instance_ttl(&env);

        BatchCommitted {
            brand,
            batch_id,
            root: merkle_root,
            warranty_months,
            unit_count,
            metadata_cid,
        }
        .publish(&env);
        Ok(())
    }

    /// Sets a batch's custody transfer cap (brand admin only).
    /// None removes the cap; Some(0) disables transfers without resetting unit counters.
    pub fn set_max_transfers(
        env: Env,
        brand: Address,
        batch_id: BytesN<32>,
        max_transfers: Option<u32>,
    ) -> Result<(), RegistryError> {
        let brand_record = storage::get_brand(&env, &brand).ok_or(RegistryError::BrandNotFound)?;
        brand_record.admin.require_auth();
        let mut batch =
            storage::get_batch(&env, &brand, &batch_id).ok_or(RegistryError::BatchNotFound)?;
        batch.max_transfers = max_transfers;
        storage::set_batch(&env, &brand, &batch_id, &batch);
        storage::extend_instance_ttl(&env);
        BatchTransferLimitUpdated {
            brand,
            batch_id,
            max_transfers,
        }
        .publish(&env);
        Ok(())
    }

    // -------------------------------------------------------------------------
    // Unit Lifecycle: Activation & Resale Transfers
    // -------------------------------------------------------------------------

    /// Lazily activates a unit on first sale or claim by verifying its Merkle proof and secret.
    pub fn activate(
        env: Env,
        brand: Address,
        batch_id: BytesN<32>,
        serial_hash: BytesN<32>,
        proof: Vec<BytesN<32>>,
        secret: Bytes,
        first_owner: Address,
    ) -> Result<BytesN<32>, RegistryError> {
        first_owner.require_auth();

        let unit_id = merkle::compute_unit_id(&env, &brand, &batch_id, &serial_hash);
        let existing_unit = storage::get_unit(&env, &unit_id);
        if let Some(unit) = &existing_unit {
            Self::ensure_unit_not_retired(unit)?;
        }

        let batch =
            storage::get_batch(&env, &brand, &batch_id).ok_or(RegistryError::BatchNotFound)?;
        if batch.recalled {
            return Err(RegistryError::BatchRecalled);
        }
        if batch.frozen {
            return Err(RegistryError::BatchFrozen);
        }
        if batch.status == BatchStatus::Expired {
            return Err(RegistryError::BatchExpired);
        }

        if existing_unit.is_some() {
            DuplicateAttempt {
                unit_id,
                caller: first_owner,
            }
            .publish(&env);
            return Err(RegistryError::UnitAlreadyActivated);
        }

        let secret_hash = merkle::sha256_bytes(&env, &secret);
        let leaf = merkle::compute_leaf(&env, &serial_hash, &secret_hash);
        if !merkle::verify_proof(&env, &batch.merkle_root, &leaf, &proof) {
            return Err(RegistryError::InvalidProof);
        }

        let now = env.ledger().timestamp();
        let warranty_duration = (batch.warranty_months as u64).saturating_mul(SECONDS_PER_MONTH);
        let warranty_expiry = now.saturating_add(warranty_duration);

        let unit = Unit {
            brand: brand.clone(),
            batch_id: batch_id.clone(),
            owner: first_owner.clone(),
            status: UnitStatus::Active,
            transfer_count: 0,
            activated_at: now,
            last_transferred_at: 0,
            warranty_expiry,
            claims_used: 0,
            history_len: 1,
            duplicate_attempts: 0,
        };

        storage::set_unit(&env, &unit_id, &unit);
        storage::extend_batch_ttl(
            &env,
            &storage::DataKey::Batch(brand.clone(), batch_id.clone()),
            batch.warranty_months,
        );
        storage::extend_instance_ttl(&env);

        UnitActivated {
            unit_id: unit_id.clone(),
            brand,
            batch_id,
            owner: first_owner,
            warranty_expiry,
        }
        .publish(&env);

        Ok(unit_id)
    }

    /// Permanently retires a unit and records its recycling certificate (owner or brand admin).
    pub fn retire_unit(
        env: Env,
        caller: Address,
        unit_id: BytesN<32>,
        reason_code: u32,
        cert_hash: BytesN<32>,
    ) -> Result<(), RegistryError> {
        caller.require_auth();
        let mut unit = storage::get_unit(&env, &unit_id).ok_or(RegistryError::UnitNotFound)?;
        if caller != unit.owner {
            let brand =
                storage::get_brand(&env, &unit.brand).ok_or(RegistryError::BrandNotFound)?;
            if caller != brand.admin {
                return Err(RegistryError::NotAuthorized);
            }
        }
        Self::ensure_unit_not_retired(&unit)?;
        let retirement = UnitRetirement {
            caller: caller.clone(),
            reason_code,
            cert_hash: cert_hash.clone(),
            retired_at: env.ledger().timestamp(),
        };
        unit.status = UnitStatus::Retired;
        unit.history_len = unit.history_len.saturating_add(1);
        storage::remove_offer(&env, &unit_id);
        storage::set_unit(&env, &unit_id, &unit);
        storage::set_unit_retirement(&env, &unit_id, &retirement, unit.warranty_expiry);
        storage::extend_instance_ttl(&env);
        UnitRetired {
            unit_id,
            caller,
            reason_code,
            cert_hash,
        }
        .publish(&env);
        Ok(())
    }

    /// Persists a verified duplicate activation attempt on-chain when an already-claimed unit's
    /// physical package secret is submitted again, incrementing `duplicate_attempts` and emitting
    /// `duplicate_attempt` without rolling back transaction state.
    pub fn report_duplicate_attempt(
        env: Env,
        caller: Address,
        brand: Address,
        batch_id: BytesN<32>,
        serial_hash: BytesN<32>,
        proof: Vec<BytesN<32>>,
        secret: Bytes,
    ) -> Result<u32, RegistryError> {
        caller.require_auth();

        let batch =
            storage::get_batch(&env, &brand, &batch_id).ok_or(RegistryError::BatchNotFound)?;

        let secret_hash = merkle::sha256_bytes(&env, &secret);
        let leaf = merkle::compute_leaf(&env, &serial_hash, &secret_hash);
        if !merkle::verify_proof(&env, &batch.merkle_root, &leaf, &proof) {
            return Err(RegistryError::InvalidProof);
        }

        let unit_id = merkle::compute_unit_id(&env, &brand, &batch_id, &serial_hash);
        let mut unit = storage::get_unit(&env, &unit_id).ok_or(RegistryError::UnitNotFound)?;

        unit.duplicate_attempts = unit.duplicate_attempts.saturating_add(1);
        unit.history_len = unit.history_len.saturating_add(1);
        storage::set_unit(&env, &unit_id, &unit);

        DuplicateAttempt { unit_id, caller }.publish(&env);
        Ok(unit.duplicate_attempts)
    }

    /// Creates a one-time resale transfer offer authenticated by the current owner.
    pub fn create_transfer_offer(
        env: Env,
        unit_id: BytesN<32>,
        code_hash: BytesN<32>,
        expires_at: u64,
    ) -> Result<(), RegistryError> {
        let mut unit = storage::get_unit(&env, &unit_id).ok_or(RegistryError::UnitNotFound)?;
        Self::ensure_unit_operational(&env, &unit)?;
        unit.owner.require_auth();
        Self::ensure_transfer_limit(&env, &unit)?;

        let now = env.ledger().timestamp();
        // Subtract rather than adding to last_transferred_at so the cooldown
        // cannot wrap near u64::MAX or be bypassed by an earlier timestamp.
        if now.saturating_sub(unit.last_transferred_at) < TRANSFER_COOLDOWN_SECONDS {
            return Err(RegistryError::TransferCooldownActive);
        }
        if expires_at <= now {
            return Err(RegistryError::InvalidInput);
        }

        let offer = TransferOffer {
            code_hash: code_hash.clone(),
            expires_at,
            created_at: now,
        };
        storage::set_offer(&env, &unit_id, &offer);

        unit.history_len = unit.history_len.saturating_add(1);
        storage::set_unit(&env, &unit_id, &unit);

        TransferOffered {
            unit_id,
            code_hash,
            expires_at,
        }
        .publish(&env);
        Ok(())
    }

    /// Redeems a one-time transfer code to transfer ownership and remaining warranty to `new_owner`.
    pub fn redeem_transfer(
        env: Env,
        unit_id: BytesN<32>,
        code: Bytes,
        new_owner: Address,
    ) -> Result<(), RegistryError> {
        new_owner.require_auth();

        let mut unit = storage::get_unit(&env, &unit_id).ok_or(RegistryError::UnitNotFound)?;
        Self::ensure_unit_operational(&env, &unit)?;
        // A brand may have lowered the cap since the owner created this offer.
        Self::ensure_transfer_limit(&env, &unit)?;

        let offer =
            storage::get_offer(&env, &unit_id).ok_or(RegistryError::TransferOfferNotFound)?;
        if env.ledger().timestamp() > offer.expires_at {
            return Err(RegistryError::TransferOfferExpired);
        }

        let provided_hash = merkle::sha256_bytes(&env, &code);
        if provided_hash != offer.code_hash {
            return Err(RegistryError::InvalidTransferCode);
        }

        let previous_owner = unit.owner.clone();
        unit.owner = new_owner.clone();
        unit.last_transferred_at = env.ledger().timestamp();
        unit.history_len = unit.history_len.saturating_add(1);

        storage::remove_offer(&env, &unit_id);
        storage::set_unit(&env, &unit_id, &unit);
        storage::extend_instance_ttl(&env);

        UnitTransferred {
            unit_id,
            from: previous_owner,
            to: new_owner,
            transfer_count: unit.transfer_count,
        }
        .publish(&env);
        Ok(())
    }

    /// Cancels an active resale transfer offer (current owner only).
    pub fn cancel_transfer_offer(env: Env, unit_id: BytesN<32>) -> Result<(), RegistryError> {
        let mut unit = storage::get_unit(&env, &unit_id).ok_or(RegistryError::UnitNotFound)?;
        unit.owner.require_auth();

        if storage::get_offer(&env, &unit_id).is_none() {
            return Err(RegistryError::TransferOfferNotFound);
        }

        storage::remove_offer(&env, &unit_id);
        unit.history_len = unit.history_len.saturating_add(1);
        storage::set_unit(&env, &unit_id, &unit);

        TransferCancelled { unit_id }.publish(&env);
        Ok(())
    }

    // -------------------------------------------------------------------------
    // Warranty Extensions & Claims
    // -------------------------------------------------------------------------

    /// Adds months to the existing expiry, including for a lapsed warranty (brand admin only).
    /// Total coverage cannot exceed 120 months from activation.
    pub fn extend_warranty(
        env: Env,
        brand: Address,
        unit_id: BytesN<32>,
        additional_months: u32,
    ) -> Result<u64, RegistryError> {
        if additional_months == 0 {
            return Err(RegistryError::InvalidInput);
        }
        let mut unit = storage::get_unit(&env, &unit_id).ok_or(RegistryError::UnitNotFound)?;
        if unit.brand != brand {
            return Err(RegistryError::NotAuthorized);
        }
        let brand_record = storage::get_brand(&env, &brand).ok_or(RegistryError::BrandNotFound)?;
        brand_record.admin.require_auth();
        Self::ensure_unit_operational(&env, &unit)?;

        let ceiling = unit
            .activated_at
            .checked_add(u64::from(MAX_WARRANTY_MONTHS) * SECONDS_PER_MONTH)
            .ok_or(RegistryError::InvalidInput)?;
        let new_warranty_end = unit
            .warranty_expiry
            .checked_add(u64::from(additional_months) * SECONDS_PER_MONTH)
            .ok_or(RegistryError::WarrantyLimitReached)?;
        if new_warranty_end > ceiling {
            return Err(RegistryError::WarrantyLimitReached);
        }

        unit.warranty_expiry = new_warranty_end;
        unit.history_len = unit.history_len.saturating_add(1);
        storage::set_unit(&env, &unit_id, &unit);
        storage::extend_instance_ttl(&env);
        WarrantyExtended {
            unit_id,
            added_months: additional_months,
            new_warranty_end,
        }
        .publish(&env);
        Ok(new_warranty_end)
    }

    /// Files a warranty claim with an authorized service center for the unit's brand.
    pub fn file_claim(
        env: Env,
        unit_id: BytesN<32>,
        service_center: Address,
    ) -> Result<u32, RegistryError> {
        let config = storage::get_config(&env).ok_or(RegistryError::NotInitialized)?;
        let mut unit = storage::get_unit(&env, &unit_id).ok_or(RegistryError::UnitNotFound)?;
        let batch = Self::ensure_unit_operational(&env, &unit)?;
        if batch.frozen {
            return Err(RegistryError::BatchFrozen);
        }
        unit.owner.require_auth();

        // Filing starts with inspection; settlement checks the actual outcome tier.
        Self::require_service_center_tier(&env, &unit.brand, &service_center, 1)?;

        let now = env.ledger().timestamp();
        if now > unit.warranty_expiry {
            return Err(RegistryError::WarrantyExpired);
        }

        if unit.claims_used >= config.max_claims_per_unit {
            return Err(RegistryError::ClaimLimitReached);
        }

        let claim_id = unit.claims_used + 1;
        unit.claims_used = claim_id;
        unit.history_len = unit.history_len.saturating_add(1);

        let claim = Claim {
            id: claim_id,
            service_center: service_center.clone(),
            filed_at: now,
            resolved_at: 0,
            outcome: ClaimOutcome::Pending,
            report_hash: BytesN::from_array(&env, &[0u8; 32]),
        };

        storage::set_claim(&env, &unit_id, &claim);
        storage::set_unit(&env, &unit_id, &unit);
        storage::extend_instance_ttl(&env);

        ClaimFiled {
            unit_id,
            claim_id,
            service_center,
        }
        .publish(&env);
        Ok(claim_id)
    }

    /// Resolves a pending warranty claim (authorized service center only).
    pub fn resolve_claim(
        env: Env,
        unit_id: BytesN<32>,
        claim_id: u32,
        outcome: ClaimOutcome,
        report_hash: BytesN<32>,
    ) -> Result<(), RegistryError> {
        if outcome == ClaimOutcome::Pending {
            return Err(RegistryError::InvalidInput);
        }

        let mut unit = storage::get_unit(&env, &unit_id).ok_or(RegistryError::UnitNotFound)?;
        Self::ensure_unit_not_retired(&unit)?;
        let mut claim =
            storage::get_claim(&env, &unit_id, claim_id).ok_or(RegistryError::ClaimNotFound)?;

        if claim.outcome != ClaimOutcome::Pending {
            return Err(RegistryError::ClaimAlreadyResolved);
        }

        let required_tier = match outcome {
            ClaimOutcome::Repaired => 2,
            ClaimOutcome::Replaced => 3,
            _ => 1,
        };
        Self::require_service_center_tier(&env, &unit.brand, &claim.service_center, required_tier)?;
        claim.service_center.require_auth();

        claim.outcome = outcome;
        claim.report_hash = report_hash.clone();
        claim.resolved_at = env.ledger().timestamp();
        storage::set_claim(&env, &unit_id, &claim);

        if outcome == ClaimOutcome::Replaced {
            unit.status = UnitStatus::Retired;
            storage::remove_offer(&env, &unit_id);
        }
        unit.history_len = unit.history_len.saturating_add(1);
        storage::set_unit(&env, &unit_id, &unit);
        storage::extend_instance_ttl(&env);

        ClaimResolved {
            unit_id,
            claim_id,
            outcome,
            report_hash,
        }
        .publish(&env);
        Ok(())
    }

    // -------------------------------------------------------------------------
    // Safety, Anti-Counterfeit Flags & Recalls
    // -------------------------------------------------------------------------

    /// Temporarily suspends activations and new warranty claims (brand admin only).
    pub fn freeze_batch(
        env: Env,
        brand: Address,
        batch_id: BytesN<32>,
    ) -> Result<(), RegistryError> {
        let record = storage::get_brand(&env, &brand).ok_or(RegistryError::BrandNotFound)?;
        Self::require_single_brand_admin(&record)?;
        Self::set_batch_frozen_internal(&env, brand, batch_id, true)
    }

    /// Clears a temporary suspension without reversing a permanent recall (brand admin only).
    pub fn unfreeze_batch(
        env: Env,
        brand: Address,
        batch_id: BytesN<32>,
    ) -> Result<(), RegistryError> {
        let record = storage::get_brand(&env, &brand).ok_or(RegistryError::BrandNotFound)?;
        Self::require_single_brand_admin(&record)?;
        Self::set_batch_frozen_internal(&env, brand, batch_id, false)
    }

    fn set_batch_frozen_internal(
        env: &Env,
        brand: Address,
        batch_id: BytesN<32>,
        frozen: bool,
    ) -> Result<(), RegistryError> {
        let mut batch =
            storage::get_batch(env, &brand, &batch_id).ok_or(RegistryError::BatchNotFound)?;
        if batch.recalled {
            return Err(RegistryError::BatchRecalled);
        }
        if batch.frozen != frozen {
            batch.frozen = frozen;
            storage::set_batch(env, &brand, &batch_id, &batch);
            if frozen {
                BatchFrozen { brand, batch_id }.publish(env);
            } else {
                BatchUnfrozen { brand, batch_id }.publish(env);
            }
        }
        Ok(())
    }

    /// Flags an individual unit as compromised, stolen, or counterfeit (brand admin only).
    pub fn flag_unit(
        env: Env,
        unit_id: BytesN<32>,
        reason_hash: BytesN<32>,
    ) -> Result<(), RegistryError> {
        let mut unit = storage::get_unit(&env, &unit_id).ok_or(RegistryError::UnitNotFound)?;
        let brand_record =
            storage::get_brand(&env, &unit.brand).ok_or(RegistryError::BrandNotFound)?;
        brand_record.admin.require_auth();
        Self::ensure_unit_not_retired(&unit)?;

        unit.status = UnitStatus::Flagged;
        unit.history_len = unit.history_len.saturating_add(1);
        storage::remove_offer(&env, &unit_id);
        storage::set_unit(&env, &unit_id, &unit);

        UnitFlagged {
            unit_id,
            reason_hash,
        }
        .publish(&env);
        Ok(())
    }

    /// Recalls a batch with a severity tier (1..=3) and regulatory notice digest (brand admin only).
    pub fn recall_batch(
        env: Env,
        brand: Address,
        batch_id: BytesN<32>,
        severity: u32,
        notice_hash: BytesN<32>,
    ) -> Result<(), RegistryError> {
        if !(1..=3).contains(&severity) {
            return Err(RegistryError::InvalidInput);
        }
        let brand_record = storage::get_brand(&env, &brand).ok_or(RegistryError::BrandNotFound)?;
        Self::require_single_brand_admin(&brand_record)?;

        Self::recall_batch_internal(&env, brand, batch_id, severity, notice_hash)
    }

    fn recall_batch_internal(
        env: &Env,
        brand: Address,
        batch_id: BytesN<32>,
        severity: u32,
        notice_hash: BytesN<32>,
    ) -> Result<(), RegistryError> {
        if !(1..=3).contains(&severity) {
            return Err(RegistryError::InvalidInput);
        }
        let mut batch =
            storage::get_batch(env, &brand, &batch_id).ok_or(RegistryError::BatchNotFound)?;
        batch.recalled = true;
        batch.status = BatchStatus::Recalled;
        let info = RecallInfo {
            severity,
            notice_hash: notice_hash.clone(),
            recalled_at: env.ledger().timestamp(),
        };
        storage::set_batch_recall_info(env, &brand, &batch_id, &info, batch.warranty_months);
        storage::set_batch(env, &brand, &batch_id, &batch);

        BatchRecalled {
            brand,
            batch_id,
            severity,
            reason_hash: notice_hash.clone(),
            notice_hash,
        }
        .publish(env);
        Ok(())
    }

    // -------------------------------------------------------------------------
    // TTL Maintenance
    // -------------------------------------------------------------------------

    /// Extends TTL for a persistent unit record (callable by maintenance workers).
    pub fn bump_unit_ttl(env: Env, unit_id: BytesN<32>) -> Result<(), RegistryError> {
        let unit = storage::get_unit(&env, &unit_id).ok_or(RegistryError::UnitNotFound)?;
        storage::extend_unit_ttl_for_warranty(
            &env,
            &storage::DataKey::Unit(unit_id),
            unit.warranty_expiry,
        );
        storage::extend_instance_ttl(&env);
        Ok(())
    }

    /// Extends TTL for a persistent batch record (callable by maintenance workers).
    pub fn bump_batch_ttl(
        env: Env,
        brand: Address,
        batch_id: BytesN<32>,
    ) -> Result<(), RegistryError> {
        let batch =
            storage::get_batch(&env, &brand, &batch_id).ok_or(RegistryError::BatchNotFound)?;
        storage::extend_batch_ttl(
            &env,
            &storage::DataKey::Batch(brand, batch_id),
            batch.warranty_months,
        );
        storage::extend_instance_ttl(&env);
        Ok(())
    }

    // -------------------------------------------------------------------------
    // Public Reads & Verification
    // -------------------------------------------------------------------------

    pub fn get_config(env: Env) -> Option<Config> {
        storage::get_config(&env)
    }

    pub fn get_brand(env: Env, brand: Address) -> Option<Brand> {
        storage::get_brand(&env, &brand)
    }

    pub fn is_service_center(env: Env, brand: Address, service_center: Address) -> bool {
        storage::is_service_center(&env, &brand, &service_center)
    }

    pub fn get_service_center(
        env: Env,
        brand: Address,
        service_center: Address,
    ) -> Option<ServiceCenter> {
        storage::get_service_center(&env, &brand, &service_center)
    }

    pub fn get_batch(env: Env, brand: Address, batch_id: BytesN<32>) -> Option<Batch> {
        storage::get_batch(&env, &brand, &batch_id)
    }

    /// Returns the immutable optional document digest for a committed batch.
    pub fn get_batch_metadata_cid(
        env: Env,
        brand: Address,
        batch_id: BytesN<32>,
    ) -> Option<BytesN<32>> {
        storage::get_batch(&env, &brand, &batch_id).and_then(|batch| batch.metadata_cid)
    }

    pub fn get_batch_recall_info(
        env: Env,
        brand: Address,
        batch_id: BytesN<32>,
    ) -> Option<RecallInfo> {
        storage::get_batch_recall_info(&env, &brand, &batch_id)
    }

    pub fn get_unit(env: Env, unit_id: BytesN<32>) -> Option<UnitView> {
        let unit = storage::get_unit(&env, &unit_id)?;
        Some(Self::build_unit_view(&env, unit_id, unit))
    }

    pub fn get_unit_retirement(env: Env, unit_id: BytesN<32>) -> Option<UnitRetirement> {
        storage::get_unit_retirement(&env, &unit_id)
    }

    pub fn get_claim(env: Env, unit_id: BytesN<32>, claim_id: u32) -> Option<Claim> {
        storage::get_claim(&env, &unit_id, claim_id)
    }

    pub fn get_transfer_offer(env: Env, unit_id: BytesN<32>) -> Option<TransferOffer> {
        storage::get_offer(&env, &unit_id)
    }

    pub fn compute_unit_id(
        env: Env,
        brand: Address,
        batch_id: BytesN<32>,
        serial_hash: BytesN<32>,
    ) -> BytesN<32> {
        merkle::compute_unit_id(&env, &brand, &batch_id, &serial_hash)
    }

    pub fn is_warranty_valid(env: Env, unit_id: BytesN<32>) -> bool {
        let Some(unit) = storage::get_unit(&env, &unit_id) else {
            return false;
        };
        let Some(batch) = storage::get_batch(&env, &unit.brand, &unit.batch_id) else {
            return false;
        };
        if batch.recalled || unit.status != UnitStatus::Active {
            return false;
        }
        env.ledger().timestamp() <= unit.warranty_expiry
    }

    /// Public verification helper combining batch lookup, Merkle proof validation, and unit state.
    pub fn verify_serial(
        env: Env,
        brand: Address,
        batch_id: BytesN<32>,
        serial_hash: BytesN<32>,
        proof: Vec<BytesN<32>>,
        secret_hash: BytesN<32>,
    ) -> VerifyResult {
        let unit_id = merkle::compute_unit_id(&env, &brand, &batch_id, &serial_hash);
        let brand_verified = storage::get_brand(&env, &brand)
            .map(|b| b.verified)
            .unwrap_or(false);

        let Some(batch) = storage::get_batch(&env, &brand, &batch_id) else {
            return VerifyResult {
                status: VerifyStatus::Unknown,
                unit_id,
                brand_verified,
                proof_valid: false,
                activated: false,
                warranty_valid: false,
                batch_recalled: false,
                owner: None,
                activated_at: 0,
                warranty_expiry: 0,
                claims_used: 0,
                duplicate_attempts: 0,
            };
        };

        let leaf = merkle::compute_leaf(&env, &serial_hash, &secret_hash);
        let proof_valid = merkle::verify_proof(&env, &batch.merkle_root, &leaf, &proof);

        if let Some(unit) = storage::get_unit(&env, &unit_id) {
            let view = Self::build_unit_view(&env, unit_id.clone(), unit);
            let status = match view.status {
                UnitStatus::Recalled => VerifyStatus::Recalled,
                UnitStatus::Flagged => VerifyStatus::Flagged,
                UnitStatus::Retired => VerifyStatus::Retired,
                UnitStatus::Active => VerifyStatus::AuthenticActive,
            };
            return VerifyResult {
                status,
                unit_id,
                brand_verified,
                proof_valid,
                activated: true,
                warranty_valid: view.warranty_valid,
                batch_recalled: view.batch_recalled,
                owner: Some(view.owner),
                activated_at: view.activated_at,
                warranty_expiry: view.warranty_expiry,
                claims_used: view.claims_used,
                duplicate_attempts: view.duplicate_attempts,
            };
        }

        if !proof_valid {
            return VerifyResult {
                status: VerifyStatus::Unknown,
                unit_id,
                brand_verified,
                proof_valid: false,
                activated: false,
                warranty_valid: false,
                batch_recalled: batch.recalled,
                owner: None,
                activated_at: 0,
                warranty_expiry: 0,
                claims_used: 0,
                duplicate_attempts: 0,
            };
        }

        let status = if batch.recalled {
            VerifyStatus::Recalled
        } else {
            VerifyStatus::AuthenticInactive
        };

        VerifyResult {
            status,
            unit_id,
            brand_verified,
            proof_valid: true,
            activated: false,
            warranty_valid: false,
            batch_recalled: batch.recalled,
            owner: None,
            activated_at: 0,
            warranty_expiry: 0,
            claims_used: 0,
            duplicate_attempts: 0,
        }
    }

    // -------------------------------------------------------------------------
    // Internal Helpers
    // -------------------------------------------------------------------------

    fn require_verified_brand(env: &Env, brand: &Address) -> Result<Brand, RegistryError> {
        let record = storage::get_brand(env, brand).ok_or(RegistryError::BrandNotFound)?;
        if !record.verified {
            return Err(RegistryError::BrandNotVerified);
        }
        Ok(record)
    }

    fn ensure_unit_operational(env: &Env, unit: &Unit) -> Result<Batch, RegistryError> {
        Self::ensure_unit_not_retired(unit)?;
        let batch = storage::get_batch(env, &unit.brand, &unit.batch_id)
            .ok_or(RegistryError::BatchNotFound)?;
        if batch.recalled || unit.status == UnitStatus::Recalled {
            return Err(RegistryError::BatchRecalled);
        }
        if unit.status == UnitStatus::Flagged {
            return Err(RegistryError::UnitFlagged);
        }
        Ok(batch)
    }

    fn ensure_unit_not_retired(unit: &Unit) -> Result<(), RegistryError> {
        if unit.status == UnitStatus::Retired {
            return Err(RegistryError::UnitRetired);
        }
        Ok(())
    }

    fn ensure_transfer_limit(env: &Env, unit: &Unit) -> Result<(), RegistryError> {
        let batch = storage::get_batch(env, &unit.brand, &unit.batch_id)
            .ok_or(RegistryError::BatchNotFound)?;
        if unit.transfer_count == u32::MAX
            || batch
                .max_transfers
                .is_some_and(|max| unit.transfer_count >= max)
        {
            return Err(RegistryError::TransferLimitReached);
        }
        Ok(())
    }

    fn build_unit_view(env: &Env, unit_id: BytesN<32>, unit: Unit) -> UnitView {
        let batch_recalled = storage::get_batch(env, &unit.brand, &unit.batch_id)
            .map(|b| b.recalled)
            .unwrap_or(false);

        let effective_status = if batch_recalled && unit.status == UnitStatus::Active {
            UnitStatus::Recalled
        } else {
            unit.status
        };

        let warranty_valid = !batch_recalled
            && effective_status == UnitStatus::Active
            && env.ledger().timestamp() <= unit.warranty_expiry;

        UnitView {
            unit_id,
            brand: unit.brand,
            batch_id: unit.batch_id,
            owner: unit.owner,
            status: effective_status,
            transfer_count: unit.transfer_count,
            activated_at: unit.activated_at,
            warranty_expiry: unit.warranty_expiry,
            warranty_valid,
            claims_used: unit.claims_used,
            history_len: unit.history_len,
            duplicate_attempts: unit.duplicate_attempts,
            batch_recalled,
        }
    }
}

impl VeritagRegistry {
    fn validate_admin_config(config: &BrandAdminConfig) -> Result<(), RegistryError> {
        if config.admins.is_empty()
            || config.admins.len() > 32
            || config.threshold == 0
            || config.threshold > config.admins.len()
        {
            return Err(RegistryError::InvalidInput);
        }
        let mut seen = Vec::new(config.admins.env());
        for admin in config.admins.iter() {
            if seen.contains(&admin) {
                return Err(RegistryError::InvalidInput);
            }
            seen.push_back(admin);
        }
        Ok(())
    }

    fn require_single_brand_admin(record: &Brand) -> Result<(), RegistryError> {
        if record.admin_config.threshold != 1 {
            return Err(RegistryError::NotAuthorized);
        }
        record.admin.require_auth();
        Ok(())
    }

    fn require_brand_voter(record: &Brand, caller: &Address) -> Result<(), RegistryError> {
        if !record.admin_config.admins.contains(caller) {
            return Err(RegistryError::NotAuthorized);
        }
        caller.require_auth();
        Ok(())
    }

    fn replace_brand_admins(
        env: &Env,
        brand: &Address,
        record: &mut Brand,
        config: BrandAdminConfig,
    ) -> Result<(), RegistryError> {
        Self::validate_admin_config(&config)?;
        record.admin_generation = record
            .admin_generation
            .checked_add(1)
            .ok_or(RegistryError::InvalidInput)?;
        record.admin = config.admins.get(0).ok_or(RegistryError::InvalidInput)?;
        record.admin_config = config;
        storage::set_brand(env, brand, record);
        Ok(())
    }

    fn validate_brand_action(
        env: &Env,
        brand: &Address,
        record: &Brand,
        action: &BrandAction,
    ) -> Result<(), RegistryError> {
        match action {
            BrandAction::FreezeBatch(batch_id) | BrandAction::UnfreezeBatch(batch_id) => {
                let batch =
                    storage::get_batch(env, brand, batch_id).ok_or(RegistryError::BatchNotFound)?;
                if batch.recalled {
                    return Err(RegistryError::BatchRecalled);
                }
            }
            BrandAction::RecallBatch(batch_id, _) => {
                storage::get_batch(env, brand, batch_id).ok_or(RegistryError::BatchNotFound)?;
            }
            BrandAction::RegisterServiceCenter(_) if !record.verified => {
                return Err(RegistryError::BrandNotVerified)
            }
            BrandAction::UpdateServiceCenterTier(center, tier) => {
                if !(1..=3).contains(tier) {
                    return Err(RegistryError::InvalidInput);
                }
                storage::get_service_center(env, brand, center)
                    .ok_or(RegistryError::ServiceCenterNotAuthorized)?;
            }
            BrandAction::RevokeServiceCenter(center) => {
                storage::get_service_center(env, brand, center)
                    .ok_or(RegistryError::ServiceCenterNotAuthorized)?;
            }
            BrandAction::ConfigureAdmins(config) => Self::validate_admin_config(config)?,
            _ => (),
        }
        Ok(())
    }

    fn execute_brand_action(
        env: &Env,
        brand: &Address,
        proposal_id: u32,
        record: &mut Brand,
        proposal: &mut BrandActionProposal,
    ) -> Result<(), RegistryError> {
        if proposal.executed || proposal.approvals.len() < record.admin_config.threshold {
            return Err(RegistryError::NotAuthorized);
        }
        match &proposal.action {
            BrandAction::FreezeBatch(batch_id) => {
                Self::set_batch_frozen_internal(env, brand.clone(), batch_id.clone(), true)?
            }
            BrandAction::UnfreezeBatch(batch_id) => {
                Self::set_batch_frozen_internal(env, brand.clone(), batch_id.clone(), false)?
            }
            BrandAction::RecallBatch(batch_id, reason_hash) => Self::recall_batch_internal(
                env,
                brand.clone(),
                batch_id.clone(),
                reason_hash.clone(),
            )?,
            BrandAction::RegisterServiceCenter(center) => {
                Self::register_service_center_internal(env, brand.clone(), center.clone())?
            }
            BrandAction::RevokeServiceCenter(center) => {
                Self::revoke_service_center_internal(env, brand.clone(), center.clone())?
            }
            BrandAction::UpdateServiceCenterTier(center, tier) => {
                Self::update_service_center_tier_internal(
                    env,
                    brand.clone(),
                    center.clone(),
                    *tier,
                )?
            }
            BrandAction::ConfigureAdmins(config) => {
                Self::replace_brand_admins(env, brand, record, config.clone())?
            }
        }
        proposal.executed = true;
        BrandActionExecuted {
            brand: brand.clone(),
            proposal_id,
            action: proposal.action.clone(),
            approvals: proposal.approvals.clone(),
        }
        .publish(env);
        Ok(())
    }
}

#[cfg(test)]
mod test;

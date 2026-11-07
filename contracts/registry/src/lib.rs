#![no_std]

pub mod events;
pub mod merkle;
pub mod storage;
pub mod types;

use soroban_sdk::{contract, contractimpl, Address, Bytes, BytesN, Env, String, Vec};

use crate::events::{
    BatchCommitted, BatchRecalled, BrandRegistered, BrandVerified, ClaimFiled, ClaimResolved,
    DuplicateAttempt, ServiceCenterRegistered, TransferCancelled, TransferOffered, UnitActivated,
    UnitFlagged, UnitTransferred,
};
use crate::types::{
    Batch, Brand, Claim, ClaimOutcome, Config, RegistryError, TransferOffer, Unit, UnitStatus,
    UnitView, VerifyResult, VerifyStatus, DEFAULT_MAX_CLAIMS_PER_UNIT, SECONDS_PER_MONTH,
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
        record.admin.require_auth();
        new_admin.require_auth();

        record.admin = new_admin;
        storage::set_brand(&env, &brand, &record);
        Ok(())
    }

    /// Authorizes a service center to resolve warranty claims for a verified brand.
    pub fn register_service_center(
        env: Env,
        brand: Address,
        service_center: Address,
    ) -> Result<(), RegistryError> {
        let brand_record = Self::require_verified_brand(&env, &brand)?;
        brand_record.admin.require_auth();

        storage::set_service_center(&env, &brand, &service_center, true);
        ServiceCenterRegistered {
            brand,
            service_center,
            authorized: true,
        }
        .publish(&env);
        Ok(())
    }

    /// Revokes a service center's authorization for a brand.
    pub fn revoke_service_center(
        env: Env,
        brand: Address,
        service_center: Address,
    ) -> Result<(), RegistryError> {
        let brand_record = storage::get_brand(&env, &brand).ok_or(RegistryError::BrandNotFound)?;
        brand_record.admin.require_auth();

        storage::set_service_center(&env, &brand, &service_center, false);
        ServiceCenterRegistered {
            brand,
            service_center,
            authorized: false,
        }
        .publish(&env);
        Ok(())
    }

    // -------------------------------------------------------------------------
    // Production Batches
    // -------------------------------------------------------------------------

    /// Commits a production batch Merkle root for a verified brand.
    pub fn commit_batch(
        env: Env,
        brand: Address,
        batch_id: BytesN<32>,
        merkle_root: BytesN<32>,
        warranty_months: u32,
        product_meta_hash: BytesN<32>,
        unit_count: u64,
    ) -> Result<(), RegistryError> {
        if unit_count == 0 {
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
            product_meta_hash,
            unit_count,
            created_at: env.ledger().timestamp(),
            recalled: false,
        };
        storage::set_batch(&env, &brand, &batch_id, &batch);
        storage::extend_instance_ttl(&env);

        BatchCommitted {
            brand,
            batch_id,
            root: merkle_root,
            warranty_months,
            unit_count,
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

        let batch =
            storage::get_batch(&env, &brand, &batch_id).ok_or(RegistryError::BatchNotFound)?;
        if batch.recalled {
            return Err(RegistryError::BatchRecalled);
        }

        let unit_id = merkle::compute_unit_id(&env, &brand, &batch_id, &serial_hash);
        if storage::has_unit(&env, &unit_id) {
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
            activated_at: now,
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

        let now = env.ledger().timestamp();
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
        unit.history_len = unit.history_len.saturating_add(1);

        storage::remove_offer(&env, &unit_id);
        storage::set_unit(&env, &unit_id, &unit);
        storage::extend_instance_ttl(&env);

        UnitTransferred {
            unit_id,
            from: previous_owner,
            to: new_owner,
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
    // Warranty Claims
    // -------------------------------------------------------------------------

    /// Files a warranty claim with an authorized service center for the unit's brand.
    pub fn file_claim(
        env: Env,
        unit_id: BytesN<32>,
        service_center: Address,
    ) -> Result<u32, RegistryError> {
        let config = storage::get_config(&env).ok_or(RegistryError::NotInitialized)?;
        let mut unit = storage::get_unit(&env, &unit_id).ok_or(RegistryError::UnitNotFound)?;
        Self::ensure_unit_operational(&env, &unit)?;
        unit.owner.require_auth();

        if !storage::is_service_center(&env, &unit.brand, &service_center) {
            return Err(RegistryError::ServiceCenterNotAuthorized);
        }

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
        let mut claim =
            storage::get_claim(&env, &unit_id, claim_id).ok_or(RegistryError::ClaimNotFound)?;

        if claim.outcome != ClaimOutcome::Pending {
            return Err(RegistryError::ClaimAlreadyResolved);
        }

        if !storage::is_service_center(&env, &unit.brand, &claim.service_center) {
            return Err(RegistryError::ServiceCenterNotAuthorized);
        }
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

    /// Recalls an entire production batch immediately (brand admin only).
    pub fn recall_batch(
        env: Env,
        brand: Address,
        batch_id: BytesN<32>,
        reason_hash: BytesN<32>,
    ) -> Result<(), RegistryError> {
        let brand_record = storage::get_brand(&env, &brand).ok_or(RegistryError::BrandNotFound)?;
        brand_record.admin.require_auth();

        let mut batch =
            storage::get_batch(&env, &brand, &batch_id).ok_or(RegistryError::BatchNotFound)?;
        batch.recalled = true;
        storage::set_batch(&env, &brand, &batch_id, &batch);

        BatchRecalled {
            brand,
            batch_id,
            reason_hash,
        }
        .publish(&env);
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

    pub fn get_batch(env: Env, brand: Address, batch_id: BytesN<32>) -> Option<Batch> {
        storage::get_batch(&env, &brand, &batch_id)
    }

    pub fn get_unit(env: Env, unit_id: BytesN<32>) -> Option<UnitView> {
        let unit = storage::get_unit(&env, &unit_id)?;
        Some(Self::build_unit_view(&env, unit_id, unit))
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

    fn ensure_unit_operational(env: &Env, unit: &Unit) -> Result<(), RegistryError> {
        let batch = storage::get_batch(env, &unit.brand, &unit.batch_id)
            .ok_or(RegistryError::BatchNotFound)?;
        if batch.recalled || unit.status == UnitStatus::Recalled {
            return Err(RegistryError::BatchRecalled);
        }
        if unit.status == UnitStatus::Flagged {
            return Err(RegistryError::UnitFlagged);
        }
        if unit.status == UnitStatus::Retired {
            return Err(RegistryError::UnitRetired);
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

#[cfg(test)]
mod test;

use soroban_sdk::{contracttype, Address, BytesN, Env};

use crate::types::{Batch, Brand, Claim, Config, TransferOffer, Unit, SECONDS_PER_MONTH};

/// Approximate Stellar ledger close interval (~5 seconds per ledger).
pub const SECONDS_PER_LEDGER: u64 = 5;
pub const DAY_IN_LEDGERS: u32 = 17_280;

/// Instance & admin metadata TTL constants (~30 days threshold, ~90 days extension).
pub const INSTANCE_LIFETIME_THRESHOLD: u32 = 30 * DAY_IN_LEDGERS;
pub const INSTANCE_BUMP_AMOUNT: u32 = 90 * DAY_IN_LEDGERS;

/// Persistent record baseline TTL (~60 days threshold, ~180 days extension).
pub const PERSISTENT_LIFETIME_THRESHOLD: u32 = 60 * DAY_IN_LEDGERS;
pub const PERSISTENT_BUMP_AMOUNT: u32 = 180 * DAY_IN_LEDGERS;

/// Buffer added beyond warranty expiry (~90 days) when extending unit TTL.
pub const WARRANTY_TTL_BUFFER_LEDGERS: u32 = 90 * DAY_IN_LEDGERS;

/// Safety margin added to temporary transfer offer TTL (~1 day).
pub const OFFER_TTL_BUFFER_LEDGERS: u32 = DAY_IN_LEDGERS;

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Config,
    Brand(Address),
    ServiceCenter(Address, Address),
    Batch(Address, BytesN<32>),
    Unit(BytesN<32>),
    Offer(BytesN<32>),
    Claim(BytesN<32>, u32),
}

fn clamp_ttl(env: &Env, threshold: u32, extend_to: u32) -> (u32, u32) {
    let max_ttl = env.storage().max_ttl();
    let clamped_extend = extend_to.min(max_ttl);
    let clamped_threshold = threshold.min(clamped_extend);
    (clamped_threshold, clamped_extend)
}

pub fn extend_instance_ttl(env: &Env) {
    let (threshold, extend_to) = clamp_ttl(env, INSTANCE_LIFETIME_THRESHOLD, INSTANCE_BUMP_AMOUNT);
    if extend_to > 0 {
        env.storage().instance().extend_ttl(threshold, extend_to);
    }
}

pub fn extend_persistent_baseline(env: &Env, key: &DataKey) {
    let (threshold, extend_to) =
        clamp_ttl(env, PERSISTENT_LIFETIME_THRESHOLD, PERSISTENT_BUMP_AMOUNT);
    if extend_to > 0 {
        env.storage()
            .persistent()
            .extend_ttl(key, threshold, extend_to);
    }
}

/// Computes target TTL ledgers covering a unit's remaining warranty plus buffer,
/// clamped safely to the network's `max_ttl`.
pub fn extend_unit_ttl_for_warranty(env: &Env, key: &DataKey, warranty_expiry: u64) {
    let now = env.ledger().timestamp();
    let remaining_secs = warranty_expiry.saturating_sub(now);
    let warranty_ledgers = (remaining_secs / SECONDS_PER_LEDGER) as u32;
    let target = warranty_ledgers
        .saturating_add(WARRANTY_TTL_BUFFER_LEDGERS)
        .max(PERSISTENT_BUMP_AMOUNT);
    let threshold = target / 2;
    let (clamped_threshold, clamped_extend) = clamp_ttl(env, threshold, target);
    if clamped_extend > 0 {
        env.storage()
            .persistent()
            .extend_ttl(key, clamped_threshold, clamped_extend);
    }
}

pub fn extend_batch_ttl(env: &Env, key: &DataKey, warranty_months: u32) {
    let warranty_secs = (warranty_months as u64).saturating_mul(SECONDS_PER_MONTH);
    let warranty_ledgers = (warranty_secs / SECONDS_PER_LEDGER) as u32;
    let target = warranty_ledgers
        .saturating_add(WARRANTY_TTL_BUFFER_LEDGERS)
        .max(PERSISTENT_BUMP_AMOUNT);
    let threshold = target / 2;
    let (clamped_threshold, clamped_extend) = clamp_ttl(env, threshold, target);
    if clamped_extend > 0 {
        env.storage()
            .persistent()
            .extend_ttl(key, clamped_threshold, clamped_extend);
    }
}

// --- Config ---

pub fn has_config(env: &Env) -> bool {
    env.storage().instance().has(&DataKey::Config)
}

pub fn get_config(env: &Env) -> Option<Config> {
    env.storage().instance().get(&DataKey::Config)
}

pub fn set_config(env: &Env, config: &Config) {
    env.storage().instance().set(&DataKey::Config, config);
    extend_instance_ttl(env);
}

// --- Brand ---

pub fn get_brand(env: &Env, brand: &Address) -> Option<Brand> {
    env.storage()
        .persistent()
        .get(&DataKey::Brand(brand.clone()))
}

pub fn set_brand(env: &Env, brand_addr: &Address, brand: &Brand) {
    let key = DataKey::Brand(brand_addr.clone());
    env.storage().persistent().set(&key, brand);
    extend_persistent_baseline(env, &key);
}

// --- Service Center ---

pub fn is_service_center(env: &Env, brand: &Address, service_center: &Address) -> bool {
    let key = DataKey::ServiceCenter(brand.clone(), service_center.clone());
    env.storage().persistent().get(&key).unwrap_or(false)
}

pub fn set_service_center(env: &Env, brand: &Address, service_center: &Address, authorized: bool) {
    let key = DataKey::ServiceCenter(brand.clone(), service_center.clone());
    if authorized {
        env.storage().persistent().set(&key, &true);
        extend_persistent_baseline(env, &key);
    } else if env.storage().persistent().has(&key) {
        env.storage().persistent().remove(&key);
    }
}

// --- Batch ---

pub fn has_batch(env: &Env, brand: &Address, batch_id: &BytesN<32>) -> bool {
    env.storage()
        .persistent()
        .has(&DataKey::Batch(brand.clone(), batch_id.clone()))
}

pub fn get_batch(env: &Env, brand: &Address, batch_id: &BytesN<32>) -> Option<Batch> {
    env.storage()
        .persistent()
        .get(&DataKey::Batch(brand.clone(), batch_id.clone()))
}

pub fn set_batch(env: &Env, brand: &Address, batch_id: &BytesN<32>, batch: &Batch) {
    let key = DataKey::Batch(brand.clone(), batch_id.clone());
    env.storage().persistent().set(&key, batch);
    extend_batch_ttl(env, &key, batch.warranty_months);
}

// --- Unit ---

pub fn has_unit(env: &Env, unit_id: &BytesN<32>) -> bool {
    env.storage()
        .persistent()
        .has(&DataKey::Unit(unit_id.clone()))
}

pub fn get_unit(env: &Env, unit_id: &BytesN<32>) -> Option<Unit> {
    env.storage()
        .persistent()
        .get(&DataKey::Unit(unit_id.clone()))
}

pub fn set_unit(env: &Env, unit_id: &BytesN<32>, unit: &Unit) {
    let key = DataKey::Unit(unit_id.clone());
    env.storage().persistent().set(&key, unit);
    extend_unit_ttl_for_warranty(env, &key, unit.warranty_expiry);
}

// --- Transfer Offer (Temporary Storage) ---

pub fn get_offer(env: &Env, unit_id: &BytesN<32>) -> Option<TransferOffer> {
    env.storage()
        .temporary()
        .get(&DataKey::Offer(unit_id.clone()))
}

pub fn set_offer(env: &Env, unit_id: &BytesN<32>, offer: &TransferOffer) {
    let key = DataKey::Offer(unit_id.clone());
    env.storage().temporary().set(&key, offer);

    let now = env.ledger().timestamp();
    let remaining_secs = offer.expires_at.saturating_sub(now);
    let offer_ledgers =
        ((remaining_secs / SECONDS_PER_LEDGER) as u32).saturating_add(OFFER_TTL_BUFFER_LEDGERS);
    let (threshold, extend_to) = clamp_ttl(env, offer_ledgers, offer_ledgers);
    if extend_to > 0 {
        env.storage()
            .temporary()
            .extend_ttl(&key, threshold, extend_to);
    }
}

pub fn remove_offer(env: &Env, unit_id: &BytesN<32>) {
    let key = DataKey::Offer(unit_id.clone());
    if env.storage().temporary().has(&key) {
        env.storage().temporary().remove(&key);
    }
}

// --- Claim ---

pub fn get_claim(env: &Env, unit_id: &BytesN<32>, claim_id: u32) -> Option<Claim> {
    env.storage()
        .persistent()
        .get(&DataKey::Claim(unit_id.clone(), claim_id))
}

pub fn set_claim(env: &Env, unit_id: &BytesN<32>, claim: &Claim) {
    let key = DataKey::Claim(unit_id.clone(), claim.id);
    env.storage().persistent().set(&key, claim);
    extend_persistent_baseline(env, &key);
}

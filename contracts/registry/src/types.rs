use soroban_sdk::{contracterror, contracttype, Address, BytesN, String};

/// Default maximum warranty claims allowed per unit unless overridden.
pub const DEFAULT_MAX_CLAIMS_PER_UNIT: u32 = 5;

/// Seconds per warranty month (30.4375 days average = 2,629,800 seconds, or standard 30 days = 2,592,000s).
/// Using 30 days (2,592,000 seconds) for deterministic, transparent on-chain calculation.
pub const SECONDS_PER_MONTH: u64 = 30 * 24 * 60 * 60;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum RegistryError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    NotAuthorized = 3,
    BrandAlreadyExists = 4,
    BrandNotFound = 5,
    BrandNotVerified = 6,
    BatchExists = 7,
    BatchNotFound = 8,
    InvalidProof = 9,
    UnitAlreadyActivated = 10,
    UnitNotFound = 11,
    WarrantyExpired = 12,
    ClaimLimitReached = 13,
    TransferOfferNotFound = 14,
    TransferOfferExpired = 15,
    InvalidTransferCode = 16,
    UnitFlagged = 17,
    BatchRecalled = 18,
    ServiceCenterNotAuthorized = 19,
    ClaimNotFound = 20,
    ClaimAlreadyResolved = 21,
    InvalidInput = 22,
    UnitRetired = 23,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Config {
    pub admin: Address,
    pub max_claims_per_unit: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Brand {
    pub admin: Address,
    pub domain: String,
    pub verified: bool,
    pub registered_at: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Batch {
    pub brand: Address,
    pub merkle_root: BytesN<32>,
    pub warranty_months: u32,
    pub product_meta_hash: BytesN<32>,
    pub unit_count: u64,
    pub created_at: u64,
    pub recalled: bool,
}

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum UnitStatus {
    Active = 0,
    Flagged = 1,
    Recalled = 2,
    Retired = 3,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Unit {
    pub brand: Address,
    pub batch_id: BytesN<32>,
    pub owner: Address,
    pub status: UnitStatus,
    pub activated_at: u64,
    pub warranty_expiry: u64,
    pub claims_used: u32,
    pub history_len: u32,
    pub duplicate_attempts: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UnitView {
    pub unit_id: BytesN<32>,
    pub brand: Address,
    pub batch_id: BytesN<32>,
    pub owner: Address,
    pub status: UnitStatus,
    pub activated_at: u64,
    pub warranty_expiry: u64,
    pub warranty_valid: bool,
    pub claims_used: u32,
    pub history_len: u32,
    pub duplicate_attempts: u32,
    pub batch_recalled: bool,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TransferOffer {
    pub code_hash: BytesN<32>,
    pub expires_at: u64,
    pub created_at: u64,
}

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum ClaimOutcome {
    Pending = 0,
    Approved = 1,
    Rejected = 2,
    Repaired = 3,
    Replaced = 4,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Claim {
    pub id: u32,
    pub service_center: Address,
    pub filed_at: u64,
    pub resolved_at: u64,
    pub outcome: ClaimOutcome,
    pub report_hash: BytesN<32>,
}

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum VerifyStatus {
    Unknown = 0,
    AuthenticInactive = 1,
    AuthenticActive = 2,
    Flagged = 3,
    Recalled = 4,
    Retired = 5,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VerifyResult {
    pub status: VerifyStatus,
    pub unit_id: BytesN<32>,
    pub brand_verified: bool,
    pub proof_valid: bool,
    pub activated: bool,
    pub warranty_valid: bool,
    pub batch_recalled: bool,
    pub owner: Option<Address>,
    pub activated_at: u64,
    pub warranty_expiry: u64,
    pub claims_used: u32,
    pub duplicate_attempts: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RetirementRecord {
    pub caller: Address,
    pub reason_code: u32,
    pub cert_hash: BytesN<32>,
    pub retired_at: u64,
}

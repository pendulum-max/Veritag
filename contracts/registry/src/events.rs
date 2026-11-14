use soroban_sdk::{contractevent, Address, BytesN, String};

use crate::types::ClaimOutcome;

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BrandRegistered {
    #[topic]
    pub brand: Address,
    pub domain: String,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BrandVerified {
    #[topic]
    pub brand: Address,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ServiceCenterRegistered {
    #[topic]
    pub brand: Address,
    #[topic]
    pub service_center: Address,
    pub authorized: bool,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BatchCommitted {
    #[topic]
    pub brand: Address,
    #[topic]
    pub batch_id: BytesN<32>,
    pub root: BytesN<32>,
    pub warranty_months: u32,
    pub unit_count: u64,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UnitActivated {
    #[topic]
    pub unit_id: BytesN<32>,
    pub brand: Address,
    pub batch_id: BytesN<32>,
    pub owner: Address,
    pub warranty_expiry: u64,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DuplicateAttempt {
    #[topic]
    pub unit_id: BytesN<32>,
    pub caller: Address,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TransferOffered {
    #[topic]
    pub unit_id: BytesN<32>,
    pub code_hash: BytesN<32>,
    pub expires_at: u64,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TransferCancelled {
    #[topic]
    pub unit_id: BytesN<32>,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UnitTransferred {
    #[topic]
    pub unit_id: BytesN<32>,
    pub from: Address,
    pub to: Address,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ClaimFiled {
    #[topic]
    pub unit_id: BytesN<32>,
    pub claim_id: u32,
    pub service_center: Address,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ClaimResolved {
    #[topic]
    pub unit_id: BytesN<32>,
    pub claim_id: u32,
    pub outcome: ClaimOutcome,
    pub report_hash: BytesN<32>,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UnitFlagged {
    #[topic]
    pub unit_id: BytesN<32>,
    pub reason_hash: BytesN<32>,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BatchRecalled {
    #[topic]
    pub brand: Address,
    #[topic]
    pub batch_id: BytesN<32>,
    pub reason_hash: BytesN<32>,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UnitRetired {
    #[topic]
    pub unit_id: BytesN<32>,
    pub caller: Address,
    pub reason_code: u32,
    pub cert_hash: BytesN<32>,
}

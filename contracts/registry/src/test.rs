extern crate std;

use soroban_sdk::{
    events::Event,
    testutils::{
        storage::Persistent as _, Address as _, Events as _, Ledger as _, MockAuth, MockAuthInvoke,
    },
    Address, Bytes, BytesN, Env, IntoVal, String, Vec,
};

use crate::{
    events::{BatchFrozen, BatchUnfrozen},
    merkle::{compute_leaf, hash_pair, sha256_bytes, MAX_PROOF_DEPTH},
    storage::DataKey,
    types::{
        ClaimOutcome, RegistryError, UnitStatus, VerifyStatus,
        DEFAULT_MAX_CLAIMS_PER_UNIT, SECONDS_PER_MONTH,
    },
    VeritagRegistry, VeritagRegistryClient,
};

type SampleUnitData = (BytesN<32>, Bytes, BytesN<32>, Vec<BytesN<32>>);

struct TestFixture<'a> {
    env: Env,
    contract_id: Address,
    client: VeritagRegistryClient<'a>,
    admin: Address,
    brand: Address,
    service_center: Address,
    alice: Address,
    bob: Address,
}

impl<'a> TestFixture<'a> {
    fn setup() -> Self {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().with_mut(|li| {
            li.timestamp = 1_700_000_000;
            li.sequence_number = 100;
        });

        let contract_id = env.register(VeritagRegistry, ());
        let client = VeritagRegistryClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let brand = Address::generate(&env);
        let service_center = Address::generate(&env);
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);

        client.init(&admin);

        Self {
            env,
            contract_id,
            client,
            admin,
            brand,
            service_center,
            alice,
            bob,
        }
    }

    fn setup_verified_brand(&self) {
        let domain = String::from_str(&self.env, "acme-hardware.example");
        self.client.register_brand(&self.brand, &domain);
        self.client.verify_brand(&self.brand);
        self.client
            .register_service_center(&self.brand, &self.service_center);
    }

    fn hash_str(&self, s: &str) -> BytesN<32> {
        let bytes = Bytes::from_slice(&self.env, s.as_bytes());
        sha256_bytes(&self.env, &bytes)
    }

    /// Builds a sorted-pair Merkle tree over `n` synthetic units and returns
    /// `(merkle_root, Vec<(serial_hash, secret_bytes, secret_hash, proof)>)`.
    fn build_sample_batch(&self, count: usize) -> (BytesN<32>, std::vec::Vec<SampleUnitData>) {
        let mut units = std::vec::Vec::with_capacity(count);
        let mut leaves = std::vec::Vec::with_capacity(count);

        for i in 0..count {
            let serial_str = std::format!("SN-{:06}", i + 1);
            let secret_str = std::format!("SECRET-{:06}-KEY", i + 1);

            let serial_hash = self.hash_str(&serial_str);
            let secret_bytes = Bytes::from_slice(&self.env, secret_str.as_bytes());
            let secret_hash = sha256_bytes(&self.env, &secret_bytes);
            let leaf = compute_leaf(&self.env, &serial_hash, &secret_hash);

            units.push((serial_hash, secret_bytes, secret_hash));
            leaves.push(leaf);
        }

        // Build layers bottom-up; duplicate odd trailing node at each level.
        let mut layers: std::vec::Vec<std::vec::Vec<BytesN<32>>> = std::vec![leaves];
        while layers.last().unwrap().len() > 1 {
            let current = layers.last().unwrap();
            let mut next = std::vec::Vec::new();
            let mut idx = 0;
            while idx < current.len() {
                let left = &current[idx];
                let right = if idx + 1 < current.len() {
                    &current[idx + 1]
                } else {
                    &current[idx]
                };
                next.push(hash_pair(&self.env, left, right));
                idx += 2;
            }
            layers.push(next);
        }

        let root = layers.last().unwrap()[0].clone();
        let mut result = std::vec::Vec::with_capacity(count);

        for (unit_idx, (serial_hash, secret_bytes, secret_hash)) in units.into_iter().enumerate() {
            let mut proof = Vec::new(&self.env);
            let mut idx = unit_idx;
            for layer in layers.iter().take(layers.len() - 1) {
                let sibling_idx = if idx % 2 == 0 {
                    if idx + 1 < layer.len() {
                        idx + 1
                    } else {
                        idx
                    }
                } else {
                    idx - 1
                };
                proof.push_back(layer[sibling_idx].clone());
                idx /= 2;
            }
            result.push((serial_hash, secret_bytes, secret_hash, proof));
        }

        (root, result)
    }
}

#[test]
fn test_init_and_admin_controls() {
    let f = TestFixture::setup();

    let cfg = f.client.get_config().unwrap();
    assert_eq!(cfg.admin, f.admin);
    assert_eq!(cfg.max_claims_per_unit, DEFAULT_MAX_CLAIMS_PER_UNIT);

    // Double init fails
    let dup = f.client.try_init(&f.admin);
    assert_eq!(dup, Err(Ok(RegistryError::AlreadyInitialized)));

    // Invalid max claims fails
    assert_eq!(
        f.client.try_set_max_claims_per_unit(&0),
        Err(Ok(RegistryError::InvalidInput))
    );

    f.client.set_max_claims_per_unit(&3);
    assert_eq!(f.client.get_config().unwrap().max_claims_per_unit, 3);

    // Rotate admin
    let new_admin = Address::generate(&f.env);
    f.client.rotate_admin(&new_admin);
    assert_eq!(f.client.get_config().unwrap().admin, new_admin);
}

#[test]
fn test_brand_registration_verification_and_key_rotation() {
    let f = TestFixture::setup();

    // Empty domain rejected
    let empty = String::from_str(&f.env, "");
    assert_eq!(
        f.client.try_register_brand(&f.brand, &empty),
        Err(Ok(RegistryError::InvalidInput))
    );

    let domain = String::from_str(&f.env, "luxury-watch.swiss");
    f.client.register_brand(&f.brand, &domain);

    // Duplicate registration rejected
    assert_eq!(
        f.client.try_register_brand(&f.brand, &domain),
        Err(Ok(RegistryError::BrandAlreadyExists))
    );

    let record = f.client.get_brand(&f.brand).unwrap();
    assert!(!record.verified);
    assert_eq!(record.domain, domain);
    assert_eq!(record.admin, f.brand);

    // Unverified brand cannot commit batches or register service centers
    let batch_id = f.hash_str("BATCH-01");
    let root = f.hash_str("ROOT");
    let meta = f.hash_str("META");
    assert_eq!(
        f.client
            .try_commit_batch(&f.brand, &batch_id, &root, &24, &meta, &100, &None, &None),
        Err(Ok(RegistryError::BrandNotVerified))
    );
    assert_eq!(
        f.client
            .try_register_service_center(&f.brand, &f.service_center),
        Err(Ok(RegistryError::BrandNotVerified))
    );

    // Verify brand
    f.client.verify_brand(&f.brand);
    assert!(f.client.get_brand(&f.brand).unwrap().verified);

    // Rotate brand admin key and commit batch with new key
    let rotated_signer = Address::generate(&f.env);
    f.client.rotate_brand_admin(&f.brand, &rotated_signer);
    assert_eq!(f.client.get_brand(&f.brand).unwrap().admin, rotated_signer);

    f.client
        .commit_batch(&f.brand, &batch_id, &root, &24, &meta, &100, &None, &None);
    assert!(f.client.get_batch(&f.brand, &batch_id).is_some());
}

#[test]
fn test_merkle_batch_commit_and_lazy_activation() {
    let f = TestFixture::setup();
    f.setup_verified_brand();

    let batch_id = f.hash_str("BATCH-2026-Q4");
    let meta_hash = f.hash_str("ipfs://product-spec-v1");
    let (merkle_root, units) = f.build_sample_batch(5); // odd leaf count tests tree padding

    // Zero unit count rejected
    assert_eq!(
        f.client.try_commit_batch(
            &f.brand,
            &batch_id,
            &merkle_root,
            &12,
            &meta_hash,
            &0,
            &None,
            &None
        ),
        Err(Ok(RegistryError::InvalidInput))
    );

    f.client.commit_batch(
        &f.brand,
        &batch_id,
        &merkle_root,
        &12,
        &meta_hash,
        &5,
        &None,
        &None,
    );

    // Duplicate batch rejected
    assert_eq!(
        f.client.try_commit_batch(
            &f.brand,
            &batch_id,
            &merkle_root,
            &12,
            &meta_hash,
            &5,
            &None,
            &None
        ),
        Err(Ok(RegistryError::BatchExists))
    );

    // Verify every unit in the 5-unit batch passes `verify_serial` as AuthenticInactive before activation
    for (serial_hash, _secret_bytes, secret_hash, proof) in units.iter() {
        let res = f
            .client
            .verify_serial(&f.brand, &batch_id, serial_hash, proof, secret_hash);
        assert_eq!(res.status, VerifyStatus::AuthenticInactive);
        assert!(res.brand_verified);
        assert!(res.proof_valid);
        assert!(!res.activated);
        assert!(!res.warranty_valid);
    }

    // Wrong secret fails activation
    let (ref serial0, ref secret0, ref secret_hash0, ref proof0) = units[0];
    let wrong_secret = Bytes::from_slice(&f.env, b"WRONG-SECRET");
    assert_eq!(
        f.client.try_activate(
            &f.brand,
            &batch_id,
            serial0,
            proof0,
            &wrong_secret,
            &f.alice
        ),
        Err(Ok(RegistryError::InvalidProof))
    );

    // Wrong serial fails activation
    let fake_serial = f.hash_str("SN-FAKE");
    assert_eq!(
        f.client
            .try_activate(&f.brand, &batch_id, &fake_serial, proof0, secret0, &f.alice),
        Err(Ok(RegistryError::InvalidProof))
    );

    // Overly deep proof rejected cleanly
    let mut huge_proof = Vec::new(&f.env);
    for _ in 0..=MAX_PROOF_DEPTH {
        huge_proof.push_back(f.hash_str("NODE"));
    }
    assert_eq!(
        f.client
            .try_activate(&f.brand, &batch_id, serial0, &huge_proof, secret0, &f.alice),
        Err(Ok(RegistryError::InvalidProof))
    );

    // Valid activation succeeds
    let unit_id = f
        .client
        .activate(&f.brand, &batch_id, serial0, proof0, secret0, &f.alice);
    assert_eq!(
        unit_id,
        f.client.compute_unit_id(&f.brand, &batch_id, serial0)
    );

    let unit_view = f.client.get_unit(&unit_id).unwrap();
    assert_eq!(unit_view.owner, f.alice);
    assert_eq!(unit_view.status, UnitStatus::Active);
    assert_eq!(unit_view.activated_at, 1_700_000_000);
    assert_eq!(
        unit_view.warranty_expiry,
        1_700_000_000 + 12 * SECONDS_PER_MONTH
    );
    assert!(unit_view.warranty_valid);
    assert!(f.client.is_warranty_valid(&unit_id));

    // Public verify now reports AuthenticActive
    let res_after = f
        .client
        .verify_serial(&f.brand, &batch_id, serial0, proof0, secret_hash0);
    assert_eq!(res_after.status, VerifyStatus::AuthenticActive);
    assert!(res_after.activated);
    assert_eq!(res_after.owner, Some(f.alice.clone()));

    // Double activation fails with UnitAlreadyActivated
    assert_eq!(
        f.client
            .try_activate(&f.brand, &batch_id, serial0, proof0, secret0, &f.bob),
        Err(Ok(RegistryError::UnitAlreadyActivated))
    );

    // Reporting duplicate attempt with valid physical secret increments counter & emits event
    let attempts = f
        .client
        .report_duplicate_attempt(&f.bob, &f.brand, &batch_id, serial0, proof0, secret0);
    assert_eq!(attempts, 1);
    assert_eq!(f.env.events().all().events().len(), 1);
    assert_eq!(f.client.get_unit(&unit_id).unwrap().duplicate_attempts, 1);
}

#[test]
fn test_resale_transfer_offer_redeem_expiry_and_cancel() {
    let f = TestFixture::setup();
    f.setup_verified_brand();

    let batch_id = f.hash_str("BATCH-RESALE");
    let meta_hash = f.hash_str("META");
    let (merkle_root, units) = f.build_sample_batch(2);
    f.client.commit_batch(
        &f.brand,
        &batch_id,
        &merkle_root,
        &24,
        &meta_hash,
        &2,
        &None,
        &None,
    );

    let (ref serial0, ref secret0, _, ref proof0) = units[0];
    let unit_id = f
        .client
        .activate(&f.brand, &batch_id, serial0, proof0, secret0, &f.alice);
    let original_warranty_expiry = f.client.get_unit(&unit_id).unwrap().warranty_expiry;

    // Advance 30 days into warranty
    f.env
        .ledger()
        .with_mut(|li| li.timestamp += SECONDS_PER_MONTH);

    let transfer_code = Bytes::from_slice(&f.env, b"ONE-TIME-RESALE-CODE-8821");
    let code_hash = sha256_bytes(&f.env, &transfer_code);
    let now = f.env.ledger().timestamp();

    // Past expiry rejected
    assert_eq!(
        f.client
            .try_create_transfer_offer(&unit_id, &code_hash, &now),
        Err(Ok(RegistryError::InvalidInput))
    );

    // Create valid offer, then cancel it
    f.client
        .create_transfer_offer(&unit_id, &code_hash, &(now + 3600));
    assert!(f.client.get_transfer_offer(&unit_id).is_some());
    f.client.cancel_transfer_offer(&unit_id);
    assert!(f.client.get_transfer_offer(&unit_id).is_none());
    assert_eq!(
        f.client
            .try_redeem_transfer(&unit_id, &transfer_code, &f.bob),
        Err(Ok(RegistryError::TransferOfferNotFound))
    );

    // Create another offer and test wrong code + expiry
    f.client
        .create_transfer_offer(&unit_id, &code_hash, &(now + 3600));

    let bad_code = Bytes::from_slice(&f.env, b"WRONG-CODE");
    assert_eq!(
        f.client.try_redeem_transfer(&unit_id, &bad_code, &f.bob),
        Err(Ok(RegistryError::InvalidTransferCode))
    );

    // Advance past offer expiry
    f.env.ledger().with_mut(|li| li.timestamp = now + 3601);
    assert_eq!(
        f.client
            .try_redeem_transfer(&unit_id, &transfer_code, &f.bob),
        Err(Ok(RegistryError::TransferOfferExpired))
    );

    // Issue fresh offer and redeem successfully
    let now2 = f.env.ledger().timestamp();
    f.client
        .create_transfer_offer(&unit_id, &code_hash, &(now2 + 7200));
    f.client.redeem_transfer(&unit_id, &transfer_code, &f.bob);

    let updated = f.client.get_unit(&unit_id).unwrap();
    assert_eq!(updated.owner, f.bob);
    assert_eq!(updated.warranty_expiry, original_warranty_expiry);
    assert!(updated.warranty_valid);
    assert!(f.client.get_transfer_offer(&unit_id).is_none());
}

#[test]
fn test_warranty_boundary_and_claims_workflow() {
    let f = TestFixture::setup();
    f.setup_verified_brand();
    f.client.set_max_claims_per_unit(&2);

    let batch_id = f.hash_str("BATCH-CLAIMS");
    let meta_hash = f.hash_str("META");
    let (merkle_root, units) = f.build_sample_batch(2);
    f.client.commit_batch(
        &f.brand,
        &batch_id,
        &merkle_root,
        &6,
        &meta_hash,
        &2,
        &None,
        &None,
    );

    let (ref serial0, ref secret0, _, ref proof0) = units[0];
    let unit_id = f
        .client
        .activate(&f.brand, &batch_id, serial0, proof0, secret0, &f.alice);

    // Unauthorized service center rejected
    let rogue_sc = Address::generate(&f.env);
    assert_eq!(
        f.client.try_file_claim(&unit_id, &rogue_sc),
        Err(Ok(RegistryError::ServiceCenterNotAuthorized))
    );

    // Claim #1 filed and repaired
    let claim1_id = f.client.file_claim(&unit_id, &f.service_center);
    assert_eq!(claim1_id, 1);

    let report1 = f.hash_str("report-battery-repaired.pdf");
    assert_eq!(
        f.client
            .try_resolve_claim(&unit_id, &claim1_id, &ClaimOutcome::Pending, &report1),
        Err(Ok(RegistryError::InvalidInput))
    );
    f.client
        .resolve_claim(&unit_id, &claim1_id, &ClaimOutcome::Repaired, &report1);

    // Cannot resolve twice
    assert_eq!(
        f.client
            .try_resolve_claim(&unit_id, &claim1_id, &ClaimOutcome::Approved, &report1),
        Err(Ok(RegistryError::ClaimAlreadyResolved))
    );

    // Exact warranty expiry boundary is still valid
    let expiry = f.client.get_unit(&unit_id).unwrap().warranty_expiry;
    f.env.ledger().with_mut(|li| li.timestamp = expiry);
    assert!(f.client.is_warranty_valid(&unit_id));

    // Claim #2 at exact boundary succeeds
    let claim2_id = f.client.file_claim(&unit_id, &f.service_center);
    assert_eq!(claim2_id, 2);

    // Claim #3 hits ClaimLimitReached (limit = 2)
    assert_eq!(
        f.client.try_file_claim(&unit_id, &f.service_center),
        Err(Ok(RegistryError::ClaimLimitReached))
    );

    // Resolving Claim #2 with Replaced retires the unit
    let report2 = f.hash_str("report-unit-replaced.pdf");
    f.client
        .resolve_claim(&unit_id, &claim2_id, &ClaimOutcome::Replaced, &report2);
    let retired_view = f.client.get_unit(&unit_id).unwrap();
    assert_eq!(retired_view.status, UnitStatus::Retired);
    assert!(!f.client.is_warranty_valid(&unit_id));

    // Activate unit #2 and test WarrantyExpired 1 second past expiry
    let (ref serial1, ref secret1, _, ref proof1) = units[1];
    let unit2_id = f
        .client
        .activate(&f.brand, &batch_id, serial1, proof1, secret1, &f.bob);
    let expiry2 = f.client.get_unit(&unit2_id).unwrap().warranty_expiry;
    f.env.ledger().with_mut(|li| li.timestamp = expiry2 + 1);
    assert!(!f.client.is_warranty_valid(&unit2_id));
    assert_eq!(
        f.client.try_file_claim(&unit2_id, &f.service_center),
        Err(Ok(RegistryError::WarrantyExpired))
    );
}

#[test]
fn test_flag_unit_and_recall_batch_across_entrypoints() {
    let f = TestFixture::setup();
    f.setup_verified_brand();

    let batch_id = f.hash_str("BATCH-SAFETY");
    let meta_hash = f.hash_str("META");
    let (merkle_root, units) = f.build_sample_batch(3);
    f.client.commit_batch(
        &f.brand,
        &batch_id,
        &merkle_root,
        &12,
        &meta_hash,
        &3,
        &None,
        &None,
    );

    // Activate unit 0 and unit 1; leave unit 2 unactivated
    let u0 = f.client.activate(
        &f.brand,
        &batch_id,
        &units[0].0,
        &units[0].3,
        &units[0].1,
        &f.alice,
    );
    let u1 = f.client.activate(
        &f.brand,
        &batch_id,
        &units[1].0,
        &units[1].3,
        &units[1].1,
        &f.bob,
    );

    // Flag unit 0 -> blocks transfer & claim and clears pending offer
    let code_hash = f.hash_str("CODE");
    f.client
        .create_transfer_offer(&u0, &code_hash, &(f.env.ledger().timestamp() + 1000));
    let flag_reason = f.hash_str("stolen-report-123");
    f.client.flag_unit(&u0, &flag_reason);

    assert!(f.client.get_transfer_offer(&u0).is_none());
    assert_eq!(f.client.get_unit(&u0).unwrap().status, UnitStatus::Flagged);
    assert!(!f.client.is_warranty_valid(&u0));
    assert_eq!(
        f.client
            .try_create_transfer_offer(&u0, &code_hash, &(f.env.ledger().timestamp() + 2000)),
        Err(Ok(RegistryError::UnitFlagged))
    );
    assert_eq!(
        f.client.try_file_claim(&u0, &f.service_center),
        Err(Ok(RegistryError::UnitFlagged))
    );

    // Recall entire batch -> affects active unit 1 AND unactivated unit 2
    let recall_reason = f.hash_str("thermal-safety-recall-2026");
    f.client
        .recall_batch(&f.brand, &batch_id, &1, &recall_reason);

    let u1_view = f.client.get_unit(&u1).unwrap();
    assert_eq!(u1_view.status, UnitStatus::Recalled);
    assert!(u1_view.batch_recalled);
    assert!(!f.client.is_warranty_valid(&u1));

    // Unactivated unit 2 cannot be activated and verifies as Recalled
    assert_eq!(
        f.client.try_activate(
            &f.brand,
            &batch_id,
            &units[2].0,
            &units[2].3,
            &units[2].1,
            &f.alice
        ),
        Err(Ok(RegistryError::BatchRecalled))
    );
    let v2 = f
        .client
        .verify_serial(&f.brand, &batch_id, &units[2].0, &units[2].3, &units[2].2);
    assert_eq!(v2.status, VerifyStatus::Recalled);
}

#[test]
fn test_ttl_extension_and_strict_authorization() {
    let f = TestFixture::setup();
    f.setup_verified_brand();

    let batch_id = f.hash_str("BATCH-TTL");
    let meta_hash = f.hash_str("META");
    let (merkle_root, units) = f.build_sample_batch(1);
    f.client.commit_batch(
        &f.brand,
        &batch_id,
        &merkle_root,
        &24,
        &meta_hash,
        &1,
        &None,
        &None,
    );

    let unit_id = f.client.activate(
        &f.brand,
        &batch_id,
        &units[0].0,
        &units[0].3,
        &units[0].1,
        &f.alice,
    );

    // Bump TTL helpers succeed and keep persistent storage well above baseline
    f.client.bump_batch_ttl(&f.brand, &batch_id);
    f.client.bump_unit_ttl(&unit_id);

    let unit_ttl = f.env.as_contract(&f.contract_id, || {
        f.env
            .storage()
            .persistent()
            .get_ttl(&DataKey::Unit(unit_id.clone()))
    });
    assert!(unit_ttl > 100_000);

    // Test strict authorization without `mock_all_auths`:
    // Bob attempting to create a transfer offer on Alice's unit must trap on auth!
    let code_hash = f.hash_str("UNAUTHORIZED-OFFER");
    let expires_at = f.env.ledger().timestamp() + 3600;
    f.env.mock_auths(&[MockAuth {
        address: &f.bob,
        invoke: &MockAuthInvoke {
            contract: &f.contract_id,
            fn_name: "create_transfer_offer",
            args: (unit_id.clone(), code_hash.clone(), expires_at).into_val(&f.env),
            sub_invokes: &[],
        },
    }]);
    assert!(f
        .client
        .try_create_transfer_offer(&unit_id, &code_hash, &expires_at)
        .is_err());

    // Alice signing succeeds
    f.env.mock_auths(&[MockAuth {
        address: &f.alice,
        invoke: &MockAuthInvoke {
            contract: &f.contract_id,
            fn_name: "create_transfer_offer",
            args: (unit_id.clone(), code_hash.clone(), expires_at).into_val(&f.env),
            sub_invokes: &[],
        },
    }]);
    assert!(f
        .client
        .try_create_transfer_offer(&unit_id, &code_hash, &expires_at)
        .is_ok());
}

#[test]
fn test_batch_expiration() {
    use crate::types::BatchStatus;
    let f = TestFixture::setup();
    f.setup_verified_brand();
    let batch_id = f.hash_str("PERISHABLES");
    let meta = f.hash_str("META");
    let (root, units) = f.build_sample_batch(3);
    let expiry = f.env.ledger().timestamp() + 100;
    f.client.commit_batch(
        &f.brand,
        &batch_id,
        &root,
        &12,
        &meta,
        &3,
        &Some(expiry),
        &None,
    );
    assert_eq!(
        f.client.get_batch(&f.brand, &batch_id).unwrap().status,
        BatchStatus::Active
    );
    f.client.activate(
        &f.brand,
        &batch_id,
        &units[0].0,
        &units[0].3,
        &units[0].1,
        &f.alice,
    );
    f.env.ledger().with_mut(|li| li.timestamp = expiry);
    f.client.activate(
        &f.brand,
        &batch_id,
        &units[1].0,
        &units[1].3,
        &units[1].1,
        &f.alice,
    );
    f.env.ledger().with_mut(|li| li.timestamp = expiry + 1);
    assert_eq!(
        f.client.get_batch(&f.brand, &batch_id).unwrap().status,
        BatchStatus::Expired
    );
    assert_eq!(
        f.client.try_activate(
            &f.brand,
            &batch_id,
            &units[2].0,
            &units[2].3,
            &units[2].1,
            &f.alice
        ),
        Err(Ok(RegistryError::BatchExpired))
    );
    let unit_id = f.client.compute_unit_id(&f.brand, &batch_id, &units[2].0);
    assert!(f.client.get_unit(&unit_id).is_none());
    f.client.recall_batch(&f.brand, &batch_id, &1, &meta);
    assert_eq!(
        f.client.get_batch(&f.brand, &batch_id).unwrap().status,
        BatchStatus::Recalled
    );
    assert_eq!(
        f.client.try_activate(
            &f.brand,
            &batch_id,
            &units[2].0,
            &units[2].3,
            &units[2].1,
            &f.alice
        ),
        Err(Ok(RegistryError::BatchRecalled))
    );
}

#[test]
fn test_batch_expiration_invalid_commit_and_no_expiry() {
    let f = TestFixture::setup();
    f.setup_verified_brand();
    let batch_id = f.hash_str("NO-EXPIRY");
    let meta = f.hash_str("META");
    let (root, units) = f.build_sample_batch(1);
    let now = f.env.ledger().timestamp();
    for expiry in [0, now - 1, now] {
        assert_eq!(
            f.client.try_commit_batch(
                &f.brand,
                &batch_id,
                &root,
                &12,
                &meta,
                &1,
                &Some(expiry),
                &None
            ),
            Err(Ok(RegistryError::InvalidInput))
        );
        assert!(f.client.get_batch(&f.brand, &batch_id).is_none());
    }
    f.client
        .commit_batch(&f.brand, &batch_id, &root, &12, &meta, &1, &None, &None);
    assert_eq!(
        f.client.get_batch(&f.brand, &batch_id).unwrap().expires_at,
        None
    );
    f.env
        .ledger()
        .with_mut(|li| li.timestamp = now + SECONDS_PER_MONTH * 120);
    f.client.activate(
        &f.brand,
        &batch_id,
        &units[0].0,
        &units[0].3,
        &units[0].1,
        &f.alice,
    );
}

#[test]
fn test_batch_expiration_legacy_storage() {
    let f = TestFixture::setup();
    f.setup_verified_brand();
    let batch_id = f.hash_str("LEGACY");
    let (root, units) = f.build_sample_batch(1);
    let legacy = crate::storage::LegacyBatch {
        brand: f.brand.clone(),
        merkle_root: root,
        warranty_months: 12,
        product_meta_hash: f.hash_str("META"),
        unit_count: 1,
        created_at: f.env.ledger().timestamp(),
        recalled: false,
    };
    f.env.as_contract(&f.contract_id, || {
        f.env
            .storage()
            .persistent()
            .set(&DataKey::Batch(f.brand.clone(), batch_id.clone()), &legacy);
    });
    assert_eq!(
        f.client.get_batch(&f.brand, &batch_id).unwrap().expires_at,
        None
    );
    f.client.activate(
        &f.brand,
        &batch_id,
        &units[0].0,
        &units[0].3,
        &units[0].1,
        &f.alice,
    );
    f.client
        .recall_batch(&f.brand, &batch_id, &1, &f.hash_str("RECALL"));
    assert!(f.client.get_batch(&f.brand, &batch_id).unwrap().recalled);
}

fn activate_warranty_unit(f: &TestFixture<'_>, warranty_months: u32) -> BytesN<32> {
    f.setup_verified_brand();
    let batch_id = f.hash_str("BATCH-EXTENSION");
    let (root, units) = f.build_sample_batch(1);
    f.client.commit_batch(
        &f.brand,
        &batch_id,
        &root,
        &warranty_months,
        &f.hash_str("META"),
        &1,
        &None,
        &None,
    );
    f.client.activate(
        &f.brand,
        &batch_id,
        &units[0].0,
        &units[0].3,
        &units[0].1,
        &f.alice,
    )
}

#[test]
fn test_extend_warranty_active_and_audit_event() {
    use crate::events::WarrantyExtended;
    use soroban_sdk::events::Event;

    let f = TestFixture::setup();
    let unit_id = activate_warranty_unit(&f, 12);
    let before = f.client.get_unit(&unit_id).unwrap();
    f.env
        .ledger()
        .with_mut(|li| li.timestamp += SECONDS_PER_MONTH);

    let expected_end = before.warranty_expiry + 6 * SECONDS_PER_MONTH;
    assert_eq!(
        f.client.extend_warranty(&f.brand, &unit_id, &6),
        expected_end
    );
    assert_eq!(
        f.env.events().all(),
        [WarrantyExtended {
            unit_id: unit_id.clone(),
            added_months: 6,
            new_warranty_end: expected_end,
        }
        .to_xdr(&f.env, &f.contract_id)]
    );

    let after = f.client.get_unit(&unit_id).unwrap();
    assert_eq!(after.warranty_expiry, expected_end);
    assert_eq!(after.activated_at, before.activated_at);
    assert_eq!(after.owner, before.owner);
    assert_eq!(after.claims_used, before.claims_used);
    assert_eq!(after.history_len, before.history_len + 1);
    assert!(after.warranty_valid);
    assert!(f.client.is_warranty_valid(&unit_id));
}

#[test]
fn test_extend_warranty_expired_uses_previous_expiry() {
    let f = TestFixture::setup();
    let unit_id = activate_warranty_unit(&f, 12);
    let old_end = f.client.get_unit(&unit_id).unwrap().warranty_expiry;
    f.env
        .ledger()
        .with_mut(|li| li.timestamp = old_end + 2 * SECONDS_PER_MONTH + 1);
    assert!(!f.client.is_warranty_valid(&unit_id));

    // A small extension can leave a lapsed warranty expired; it never resets to now.
    assert_eq!(
        f.client.extend_warranty(&f.brand, &unit_id, &1),
        old_end + SECONDS_PER_MONTH
    );
    assert!(!f.client.is_warranty_valid(&unit_id));
    assert_eq!(
        f.client.extend_warranty(&f.brand, &unit_id, &2),
        old_end + 3 * SECONDS_PER_MONTH
    );
    assert!(f.client.is_warranty_valid(&unit_id));
    assert_eq!(f.client.file_claim(&unit_id, &f.service_center), 1);
}

#[test]
fn test_extend_warranty_cap_and_invalid_months() {
    let f = TestFixture::setup();
    let unit_id = activate_warranty_unit(&f, 12);
    let before = f.client.get_unit(&unit_id).unwrap();
    assert_eq!(
        f.client.try_extend_warranty(&f.brand, &unit_id, &0),
        Err(Ok(RegistryError::InvalidInput))
    );
    assert_eq!(
        f.client.try_extend_warranty(&f.brand, &unit_id, &u32::MAX),
        Err(Ok(RegistryError::WarrantyLimitReached))
    );
    assert_eq!(f.client.get_unit(&unit_id).unwrap(), before);

    f.client.extend_warranty(&f.brand, &unit_id, &100);
    let ceiling = before.activated_at + 120 * SECONDS_PER_MONTH;
    assert_eq!(f.client.extend_warranty(&f.brand, &unit_id, &8), ceiling);
    let at_cap = f.client.get_unit(&unit_id).unwrap();
    assert_eq!(
        f.client.try_extend_warranty(&f.brand, &unit_id, &1),
        Err(Ok(RegistryError::WarrantyLimitReached))
    );
    assert_eq!(f.client.get_unit(&unit_id).unwrap(), at_cap);
}

#[test]
fn test_extend_warranty_requires_originating_brand_admin() {
    let f = TestFixture::setup();
    let unit_id = activate_warranty_unit(&f, 12);
    let before = f.client.get_unit(&unit_id).unwrap();
    let other_brand = Address::generate(&f.env);
    f.client
        .register_brand(&other_brand, &String::from_str(&f.env, "other.example"));
    assert_eq!(
        f.client.try_extend_warranty(&other_brand, &unit_id, &1),
        Err(Ok(RegistryError::NotAuthorized))
    );

    let rotated_admin = Address::generate(&f.env);
    f.client.rotate_brand_admin(&f.brand, &rotated_admin);
    let args: Vec<soroban_sdk::Val> = (f.brand.clone(), unit_id.clone(), 1u32).into_val(&f.env);
    // Owners, service centers, registry admins and the former brand key cannot authorize.
    for unauthorized in [&f.alice, &f.service_center, &f.admin, &f.brand] {
        f.env.mock_auths(&[MockAuth {
            address: unauthorized,
            invoke: &MockAuthInvoke {
                contract: &f.contract_id,
                fn_name: "extend_warranty",
                args: args.clone(),
                sub_invokes: &[],
            },
        }]);
        assert!(f
            .client
            .try_extend_warranty(&f.brand, &unit_id, &1)
            .is_err());
        assert_eq!(f.client.get_unit(&unit_id).unwrap(), before);
    }
    f.env.mock_auths(&[MockAuth {
        address: &rotated_admin,
        invoke: &MockAuthInvoke {
            contract: &f.contract_id,
            fn_name: "extend_warranty",
            args,
            sub_invokes: &[],
        },
    }]);
    assert_eq!(
        f.client.extend_warranty(&f.brand, &unit_id, &1),
        before.warranty_expiry + SECONDS_PER_MONTH
    );
}

#[test]
fn test_extend_warranty_missing_and_nonoperational_units() {
    let f = TestFixture::setup();
    let unit_id = activate_warranty_unit(&f, 12);
    assert_eq!(
        f.client
            .try_extend_warranty(&f.brand, &f.hash_str("MISSING"), &1),
        Err(Ok(RegistryError::UnitNotFound))
    );
    for (status, error) in [
        (UnitStatus::Recalled, RegistryError::BatchRecalled),
        (UnitStatus::Retired, RegistryError::UnitRetired),
        (UnitStatus::Flagged, RegistryError::UnitFlagged),
    ] {
        f.env.as_contract(&f.contract_id, || {
            let mut unit = crate::storage::get_unit(&f.env, &unit_id).unwrap();
            unit.status = status;
            crate::storage::set_unit(&f.env, &unit_id, &unit);
        });
        let before = f.client.get_unit(&unit_id).unwrap();
        assert_eq!(
            f.client.try_extend_warranty(&f.brand, &unit_id, &1),
            Err(Ok(error))
        );
        assert_eq!(f.client.get_unit(&unit_id).unwrap(), before);
    }
    // A recalled batch also blocks extensions of a unit whose stored status is Active.
    f.env.as_contract(&f.contract_id, || {
        let mut unit = crate::storage::get_unit(&f.env, &unit_id).unwrap();
        unit.status = UnitStatus::Active;
        crate::storage::set_unit(&f.env, &unit_id, &unit);
    });
    let batch_id = f.client.get_unit(&unit_id).unwrap().batch_id;
    f.client
        .recall_batch(&f.brand, &batch_id, &1, &f.hash_str("RECALL"));
    assert_eq!(
        f.client.try_extend_warranty(&f.brand, &unit_id, &1),
        Err(Ok(RegistryError::BatchRecalled))
    );
}

#[test]
fn test_extend_warranty_refreshes_unit_ttl() {
    let f = TestFixture::setup();
    let unit_id = activate_warranty_unit(&f, 1);
    f.env
        .ledger()
        .with_mut(|li| li.sequence_number += 1_200_000);
    f.client.bump_unit_ttl(&unit_id);
    f.env.ledger().with_mut(|li| li.sequence_number += 800_000);
    let old_ttl = f.env.as_contract(&f.contract_id, || {
        f.env
            .storage()
            .persistent()
            .get_ttl(&DataKey::Unit(unit_id.clone()))
    });
    f.client.extend_warranty(&f.brand, &unit_id, &6);
    let new_ttl = f.env.as_contract(&f.contract_id, || {
        f.env
            .storage()
            .persistent()
            .get_ttl(&DataKey::Unit(unit_id.clone()))
    });
    assert!(new_ttl > old_ttl);
}
#[test]
fn test_merged_batch_metadata_and_expiration_storage() {
    use crate::types::BatchStatus;
    use soroban_sdk::{Map, Symbol, TryFromVal, Val};

    let f = TestFixture::setup();
    f.setup_verified_brand();
    let batch_id = f.hash_str("MERGED-BATCH");
    let (root, _) = f.build_sample_batch(1);
    let metadata = f.hash_str("DOCUMENT");
    let expiry = f.env.ledger().timestamp() + 100;
    f.client.commit_batch(
        &f.brand,
        &batch_id,
        &root,
        &12,
        &f.hash_str("META"),
        &1,
        &Some(expiry),
        &Some(metadata.clone()),
    );
    let batch = f.client.get_batch(&f.brand, &batch_id).unwrap();
    assert_eq!(batch.expires_at, Some(expiry));
    assert_eq!(
        f.client.get_batch_metadata_cid(&f.brand, &batch_id),
        Some(metadata.clone())
    );

    // Preserve whichever optional feature was stored by an earlier contract version.
    for (omit_expiry, omit_metadata) in [(true, false), (false, true), (true, true)] {
        f.env.as_contract(&f.contract_id, || {
            let value: Val = batch.clone().into_val(&f.env);
            let mut fields = Map::<Symbol, Val>::try_from_val(&f.env, &value).unwrap();
            if omit_expiry {
                fields.remove(Symbol::new(&f.env, "expires_at"));
                fields.remove(Symbol::new(&f.env, "status"));
            }
            if omit_metadata {
                fields.remove(Symbol::new(&f.env, "metadata_cid"));
            }
            f.env
                .storage()
                .persistent()
                .set(&DataKey::Batch(f.brand.clone(), batch_id.clone()), &fields);
        });
        let restored = f.client.get_batch(&f.brand, &batch_id).unwrap();
        assert_eq!(
            restored.expires_at,
            if omit_expiry { None } else { Some(expiry) }
        );
        assert_eq!(
            restored.metadata_cid,
            if omit_metadata {
                None
            } else {
                Some(metadata.clone())
            }
        );
    }
    f.env.as_contract(&f.contract_id, || {
        crate::storage::set_batch(&f.env, &f.brand, &batch_id, &batch);
    });
    f.env.ledger().with_mut(|li| li.timestamp = expiry + 1);
    assert_eq!(
        f.client.get_batch(&f.brand, &batch_id).unwrap().status,
        BatchStatus::Expired
    );
    assert_eq!(
        f.client.get_batch_metadata_cid(&f.brand, &batch_id),
        Some(metadata)
    );
}

#[test]
fn test_merged_legacy_brand_governance() {
    use crate::{
        storage::LegacyBrand,
        types::{BrandAction, BrandAdminConfig},
    };

    let f = TestFixture::setup();
    let legacy = LegacyBrand {
        admin: f.brand.clone(),
        domain: String::from_str(&f.env, "legacy.example"),
        verified: true,
        registered_at: f.env.ledger().timestamp(),
    };
    f.env.as_contract(&f.contract_id, || {
        f.env
            .storage()
            .persistent()
            .set(&DataKey::Brand(f.brand.clone()), &legacy);
    });
    let config = BrandAdminConfig {
        admins: Vec::from_array(&f.env, [f.brand.clone(), f.alice.clone()]),
        threshold: 2,
    };
    f.client.configure_brand_admins(&f.brand, &config);
    assert_eq!(f.client.get_brand_admin_config(&f.brand), Some(config));
    assert_eq!(
        f.client
            .try_register_service_center(&f.brand, &f.service_center),
        Err(Ok(RegistryError::NotAuthorized)),
    );
    let proposal = f.client.propose_brand_action(
        &f.brand,
        &f.brand,
        &BrandAction::RegisterServiceCenter(f.service_center.clone()),
    );
    assert!(!f.client.is_service_center(&f.brand, &f.service_center));
    assert!(f.client.approve_brand_action(&f.alice, &f.brand, &proposal));
    assert!(f.client.is_service_center(&f.brand, &f.service_center));
}

#[test]
fn test_freeze_and_unfreeze_batch() {
    let f = TestFixture::setup();
    f.setup_verified_brand();
    let batch_id = f.hash_str("BATCH-FREEZE");
    let (root, units) = f.build_sample_batch(2);
    f.client.commit_batch(
        &f.brand,
        &batch_id,
        &root,
        &12,
        &f.hash_str("META"),
        &2,
        &None,
        &None,
    );
    assert!(!f.client.get_batch(&f.brand, &batch_id).unwrap().frozen);

    let active_unit = f.client.activate(
        &f.brand,
        &batch_id,
        &units[0].0,
        &units[0].3,
        &units[0].1,
        &f.alice,
    );
    let before = f.client.get_unit(&active_unit).unwrap();
    f.client.freeze_batch(&f.brand, &batch_id);
    assert_eq!(
        f.env.events().all(),
        [BatchFrozen {
            brand: f.brand.clone(),
            batch_id: batch_id.clone(),
        }
        .to_xdr(&f.env, &f.contract_id)]
    );
    assert!(f.client.get_batch(&f.brand, &batch_id).unwrap().frozen);

    assert_eq!(
        f.client.try_activate(
            &f.brand,
            &batch_id,
            &units[1].0,
            &units[1].3,
            &units[1].1,
            &f.bob,
        ),
        Err(Ok(RegistryError::BatchFrozen))
    );
    assert_eq!(
        f.client.try_file_claim(&active_unit, &f.service_center),
        Err(Ok(RegistryError::BatchFrozen))
    );
    assert_eq!(f.client.get_unit(&active_unit).unwrap(), before);
    let inactive_unit = f.client.compute_unit_id(&f.brand, &batch_id, &units[1].0);
    assert!(f.client.get_unit(&inactive_unit).is_none());

    // Repeated freezes are harmless and do not emit another transition event.
    f.client.freeze_batch(&f.brand, &batch_id);
    assert!(f.env.events().all().events().is_empty());
    f.client.unfreeze_batch(&f.brand, &batch_id);
    assert_eq!(
        f.env.events().all(),
        [BatchUnfrozen {
            brand: f.brand.clone(),
            batch_id: batch_id.clone(),
        }
        .to_xdr(&f.env, &f.contract_id)]
    );
    assert!(!f.client.get_batch(&f.brand, &batch_id).unwrap().frozen);
    assert_eq!(
        f.client.activate(
            &f.brand,
            &batch_id,
            &units[1].0,
            &units[1].3,
            &units[1].1,
            &f.bob,
        ),
        inactive_unit
    );
    assert_eq!(f.client.file_claim(&active_unit, &f.service_center), 1);
    assert_eq!(
        f.client.get_unit(&active_unit).unwrap().warranty_expiry,
        before.warranty_expiry
    );
    f.client.unfreeze_batch(&f.brand, &batch_id);
    assert!(f.env.events().all().events().is_empty());
    assert_eq!(RegistryError::BatchFrozen as u32, 25);
}

#[test]
fn test_freeze_requires_current_brand_admin() {
    let f = TestFixture::setup();
    f.setup_verified_brand();
    let batch_id = f.hash_str("BATCH-FREEZE-AUTH");
    let root = f.hash_str("ROOT");
    f.client
        .commit_batch(&f.brand, &batch_id, &root, &12, &root, &1, &None, &None);
    f.client.rotate_brand_admin(&f.brand, &f.bob);

    for method in ["freeze_batch", "unfreeze_batch"] {
        for signer in [&f.alice, &f.brand] {
            f.env.mock_auths(&[MockAuth {
                address: signer,
                invoke: &MockAuthInvoke {
                    contract: &f.contract_id,
                    fn_name: method,
                    args: (f.brand.clone(), batch_id.clone()).into_val(&f.env),
                    sub_invokes: &[],
                },
            }]);
            let result = if method == "freeze_batch" {
                f.client.try_freeze_batch(&f.brand, &batch_id)
            } else {
                f.client.try_unfreeze_batch(&f.brand, &batch_id)
            };
            assert!(result.is_err());
            assert_eq!(
                f.client.get_batch(&f.brand, &batch_id).unwrap().frozen,
                method == "unfreeze_batch"
            );
        }
        f.env.mock_auths(&[MockAuth {
            address: &f.bob,
            invoke: &MockAuthInvoke {
                contract: &f.contract_id,
                fn_name: method,
                args: (f.brand.clone(), batch_id.clone()).into_val(&f.env),
                sub_invokes: &[],
            },
        }]);
        if method == "freeze_batch" {
            f.client.freeze_batch(&f.brand, &batch_id);
        } else {
            f.client.unfreeze_batch(&f.brand, &batch_id);
        }
    }
}

#[test]
fn test_freeze_missing_batch_and_permanent_recall() {
    let f = TestFixture::setup();
    f.setup_verified_brand();
    let batch_id = f.hash_str("BATCH-FREEZE-RECALL");
    assert_eq!(
        f.client.try_freeze_batch(&f.brand, &batch_id),
        Err(Ok(RegistryError::BatchNotFound))
    );
    assert_eq!(
        f.client.try_unfreeze_batch(&f.brand, &batch_id),
        Err(Ok(RegistryError::BatchNotFound))
    );
    assert_eq!(
        f.client.try_freeze_batch(&f.bob, &batch_id),
        Err(Ok(RegistryError::BrandNotFound))
    );
    assert_eq!(
        f.client.try_unfreeze_batch(&f.bob, &batch_id),
        Err(Ok(RegistryError::BrandNotFound))
    );
    let (root, units) = f.build_sample_batch(1);
    f.client
        .commit_batch(&f.brand, &batch_id, &root, &12, &root, &1, &None, &None);
    let unit_id = f.client.activate(
        &f.brand,
        &batch_id,
        &units[0].0,
        &units[0].3,
        &units[0].1,
        &f.alice,
    );
    f.client.freeze_batch(&f.brand, &batch_id);
    f.client
        .recall_batch(&f.brand, &batch_id, &3, &f.hash_str("RECALL"));
    assert_eq!(
        f.client.try_unfreeze_batch(&f.brand, &batch_id),
        Err(Ok(RegistryError::BatchRecalled))
    );
    assert_eq!(
        f.client.try_freeze_batch(&f.brand, &batch_id),
        Err(Ok(RegistryError::BatchRecalled))
    );
    assert!(f.client.get_batch(&f.brand, &batch_id).unwrap().recalled);
    assert_eq!(
        f.client.try_activate(
            &f.brand,
            &batch_id,
            &units[0].0,
            &units[0].3,
            &units[0].1,
            &f.bob,
        ),
        Err(Ok(RegistryError::BatchRecalled))
    );
    assert_eq!(
        f.client.try_file_claim(&unit_id, &f.service_center),
        Err(Ok(RegistryError::BatchRecalled))
    );
}

#[test]
fn test_freeze_legacy_batch_preserves_expiration() {
    use soroban_sdk::{Map, Symbol, TryFromVal, Val};
    let f = TestFixture::setup();
    f.setup_verified_brand();
    let batch_id = f.hash_str("LEGACY-FREEZE-EXPIRATION");
    let (root, units) = f.build_sample_batch(2);
    let expiry = f.env.ledger().timestamp() + 100;
    f.client.commit_batch(
        &f.brand,
        &batch_id,
        &root,
        &12,
        &root,
        &2,
        &Some(expiry),
        &None,
    );
    let batch = f.client.get_batch(&f.brand, &batch_id).unwrap();
    let value: Val = batch.into_val(&f.env);
    let mut fields = Map::<Symbol, Val>::try_from_val(&f.env, &value).unwrap();
    fields.remove(Symbol::new(&f.env, "frozen"));
    f.env.as_contract(&f.contract_id, || {
        f.env
            .storage()
            .persistent()
            .set(&DataKey::Batch(f.brand.clone(), batch_id.clone()), &fields);
    });
    let legacy = f.client.get_batch(&f.brand, &batch_id).unwrap();
    assert!(!legacy.frozen);
    assert_eq!(legacy.expires_at, Some(expiry));
    f.client.freeze_batch(&f.brand, &batch_id);
    assert!(f.client.get_batch(&f.brand, &batch_id).unwrap().frozen);
    assert_eq!(
        f.client.try_activate(
            &f.brand,
            &batch_id,
            &units[0].0,
            &units[0].3,
            &units[0].1,
            &f.alice,
        ),
        Err(Ok(RegistryError::BatchFrozen))
    );
    f.client.unfreeze_batch(&f.brand, &batch_id);
    f.client.activate(
        &f.brand,
        &batch_id,
        &units[0].0,
        &units[0].3,
        &units[0].1,
        &f.alice,
    );

    f.env.ledger().with_mut(|li| li.timestamp = expiry + 1);
    f.client.freeze_batch(&f.brand, &batch_id);
    f.client.unfreeze_batch(&f.brand, &batch_id);
    let expired = f.client.get_batch(&f.brand, &batch_id).unwrap();
    assert_eq!(expired.expires_at, Some(expiry));
    assert_eq!(expired.status, crate::types::BatchStatus::Expired);
    assert_eq!(
        f.client.try_activate(
            &f.brand,
            &batch_id,
            &units[1].0,
            &units[1].3,
            &units[1].1,
            &f.alice,
        ),
        Err(Ok(RegistryError::BatchExpired))
    );
}

#[test]
fn test_freeze_requires_multisig_approval() {
    use crate::types::{BrandAction, BrandAdminConfig};
    let f = TestFixture::setup();
    f.setup_verified_brand();
    let batch_id = f.hash_str("MULTISIG-FREEZE");
    let (root, _) = f.build_sample_batch(1);
    let metadata = f.hash_str("METADATA");
    f.client.commit_batch(
        &f.brand,
        &batch_id,
        &root,
        &12,
        &root,
        &1,
        &None,
        &Some(metadata.clone()),
    );
    f.client.configure_brand_admins(
        &f.brand,
        &BrandAdminConfig {
            admins: Vec::from_array(&f.env, [f.brand.clone(), f.bob.clone()]),
            threshold: 2,
        },
    );
    assert_eq!(
        f.client.try_freeze_batch(&f.brand, &batch_id),
        Err(Ok(RegistryError::NotAuthorized))
    );
    let proposal = f.client.propose_brand_action(
        &f.brand,
        &f.brand,
        &BrandAction::FreezeBatch(batch_id.clone()),
    );
    assert!(!f.client.get_batch(&f.brand, &batch_id).unwrap().frozen);
    assert_eq!(
        f.client
            .try_approve_brand_action(&f.alice, &f.brand, &proposal),
        Err(Ok(RegistryError::NotAuthorized))
    );
    assert!(f.client.approve_brand_action(&f.bob, &f.brand, &proposal));
    assert!(f.client.get_batch(&f.brand, &batch_id).unwrap().frozen);
    assert_eq!(
        f.client.try_unfreeze_batch(&f.brand, &batch_id),
        Err(Ok(RegistryError::NotAuthorized))
    );
    let proposal = f.client.propose_brand_action(
        &f.bob,
        &f.brand,
        &BrandAction::UnfreezeBatch(batch_id.clone()),
    );
    assert!(f.client.get_batch(&f.brand, &batch_id).unwrap().frozen);
    assert!(f.client.approve_brand_action(&f.brand, &f.brand, &proposal));
    let batch = f.client.get_batch(&f.brand, &batch_id).unwrap();
    assert!(!batch.frozen);
    assert_eq!(batch.metadata_cid, Some(metadata));
}

#[test]
fn test_freeze_preserves_unit_retirement_guard() {
    let f = TestFixture::setup();
    f.setup_verified_brand();
    let batch_id = f.hash_str("RETIRED-FREEZE");
    let (root, units) = f.build_sample_batch(1);
    f.client
        .commit_batch(&f.brand, &batch_id, &root, &12, &root, &1, &None, &None);
    let unit_id = f.client.activate(
        &f.brand,
        &batch_id,
        &units[0].0,
        &units[0].3,
        &units[0].1,
        &f.alice,
    );
    f.client.retire_unit(&f.alice, &unit_id, &1, &root);
    f.client.freeze_batch(&f.brand, &batch_id);
    assert_eq!(
        f.client.try_activate(
            &f.brand,
            &batch_id,
            &units[0].0,
            &units[0].3,
            &units[0].1,
            &f.alice
        ),
        Err(Ok(RegistryError::UnitRetired))
    );
    assert_eq!(
        f.client.try_file_claim(&unit_id, &f.service_center),
        Err(Ok(RegistryError::UnitRetired))
    );
}

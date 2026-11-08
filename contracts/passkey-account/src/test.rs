extern crate std;

use super::*;
use p256::ecdsa::{signature::hazmat::PrehashSigner, Signature, SigningKey};
use sha2::{Digest, Sha256};
use soroban_sdk::testutils::Address as _;

fn generate_p256_keypair(env: &Env, seed_byte: u8) -> (SigningKey, BytesN<65>) {
    let mut secret_bytes = [seed_byte; 32];
    secret_bytes[0] = seed_byte.wrapping_add(1);
    let signing_key = SigningKey::from_bytes((&secret_bytes).into()).unwrap();
    let verifying_key = signing_key.verifying_key();
    let encoded = verifying_key.to_encoded_point(false);
    let bytes_slice = encoded.as_bytes();
    let mut pubkey_arr = [0u8; 65];
    pubkey_arr.copy_from_slice(bytes_slice);
    (signing_key, BytesN::from_array(env, &pubkey_arr))
}

fn sign_webauthn_challenge(
    env: &Env,
    signing_key: &SigningKey,
    credential_id: &Bytes,
    challenge: &[u8; 32],
    flags: u8,
) -> WebAuthnCredential {
    let b64_challenge = encode_base64url_32(challenge);
    let challenge_str = core::str::from_utf8(&b64_challenge).unwrap();
    let client_json_str = std::format!(
        r#"{{"type":"webauthn.get","challenge":"{}","origin":"https://veritag.stellar.org","crossOrigin":false}}"#,
        challenge_str
    );

    let mut auth_data = [0u8; 37];
    // rpIdHash = SHA256("veritag.stellar.org")
    let rp_hash = Sha256::digest(b"veritag.stellar.org");
    auth_data[..32].copy_from_slice(&rp_hash);
    auth_data[32] = flags;
    auth_data[33..37].copy_from_slice(&1u32.to_be_bytes());

    let client_data_hash = Sha256::digest(client_json_str.as_bytes());
    let mut signed_bytes = std::vec::Vec::with_capacity(69);
    signed_bytes.extend_from_slice(&auth_data);
    signed_bytes.extend_from_slice(&client_data_hash);

    let msg_digest = Sha256::digest(&signed_bytes);
    let sig: Signature = signing_key.sign_prehash(&msg_digest).unwrap();
    let sig_norm = sig.normalize_s().unwrap_or(sig);
    let sig_bytes = sig_norm.to_bytes();
    let mut sig_arr = [0u8; 64];
    sig_arr.copy_from_slice(&sig_bytes);

    WebAuthnCredential {
        credential_id: credential_id.clone(),
        authenticator_data: Bytes::from_slice(env, &auth_data),
        client_data_json: Bytes::from_slice(env, client_json_str.as_bytes()),
        signature: BytesN::from_array(env, &sig_arr),
    }
}

#[test]
fn test_webauthn_check_auth_success_and_rejections() {
    let env = Env::default();
    let (signing_key, pubkey) = generate_p256_keypair(&env, 7);
    let cred_id = Bytes::from_slice(&env, b"cred-primary-001");
    let recovery = Address::generate(&env);

    let contract_id = env.register(
        PasskeyAccountContract,
        (cred_id.clone(), pubkey.clone(), Some(recovery.clone())),
    );
    let client = PasskeyAccountContractClient::new(&env, &contract_id);

    assert_eq!(client.get_passkey(&cred_id), Some(pubkey));
    assert_eq!(client.get_passkey_count(), 1);
    assert_eq!(client.get_recovery_signer(), Some(recovery));

    let payload_bytes = [0x42u8; 32];
    let payload_hash: Hash<32> = env
        .crypto()
        .sha256(&Bytes::from_slice(&env, &payload_bytes));
    let challenge_arr = payload_hash.to_array();

    // 1. Valid WebAuthn assertion with UP (0x01) + UV (0x04) = 0x05
    let valid_cred = sign_webauthn_challenge(&env, &signing_key, &cred_id, &challenge_arr, 0x05);
    env.as_contract(&contract_id, || {
        let res = PasskeyAccountContract::__check_auth(
            env.clone(),
            payload_hash.clone(),
            AccountSignature::WebAuthn(valid_cred),
            Vec::new(&env),
        );
        assert_eq!(res, Ok(()));
    });

    // 2. Reject when User Present flag (bit 0) is 0
    let no_up_cred = sign_webauthn_challenge(&env, &signing_key, &cred_id, &challenge_arr, 0x04);
    env.as_contract(&contract_id, || {
        let res = PasskeyAccountContract::__check_auth(
            env.clone(),
            payload_hash.clone(),
            AccountSignature::WebAuthn(no_up_cred),
            Vec::new(&env),
        );
        assert_eq!(res, Err(AccountError::UserNotPresent));
    });

    // 3. Reject when challenge in clientDataJSON does not match signature_payload
    let wrong_challenge = [0x99u8; 32];
    let wrong_challenge_cred =
        sign_webauthn_challenge(&env, &signing_key, &cred_id, &wrong_challenge, 0x05);
    env.as_contract(&contract_id, || {
        let res = PasskeyAccountContract::__check_auth(
            env.clone(),
            payload_hash.clone(),
            AccountSignature::WebAuthn(wrong_challenge_cred),
            Vec::new(&env),
        );
        assert_eq!(res, Err(AccountError::ChallengeMismatch));
    });

    // 4. Reject when credential_id is unknown
    let unknown_id = Bytes::from_slice(&env, b"cred-unknown");
    let unknown_cred =
        sign_webauthn_challenge(&env, &signing_key, &unknown_id, &challenge_arr, 0x05);
    env.as_contract(&contract_id, || {
        let res = PasskeyAccountContract::__check_auth(
            env.clone(),
            payload_hash.clone(),
            AccountSignature::WebAuthn(unknown_cred),
            Vec::new(&env),
        );
        assert_eq!(res, Err(AccountError::UnknownCredential));
    });
}

#[test]
fn test_passkey_rotation_and_recovery_guards() {
    let env = Env::default();
    env.mock_all_auths();

    let (_sk1, pk1) = generate_p256_keypair(&env, 11);
    let (_sk2, pk2) = generate_p256_keypair(&env, 22);
    let cred1 = Bytes::from_slice(&env, b"cred-1");
    let cred2 = Bytes::from_slice(&env, b"cred-2");

    let contract_id = env.register(
        PasskeyAccountContract,
        (cred1.clone(), pk1.clone(), Option::<Address>::None),
    );
    let client = PasskeyAccountContractClient::new(&env, &contract_id);

    // Cannot remove the only passkey when no recovery signer is configured
    let err = client.try_remove_passkey(&cred1);
    assert_eq!(err, Err(Ok(AccountError::CannotRemoveLastAuthMethod)));

    // Add second passkey, then remove first passkey
    client.add_passkey(&cred2, &pk2);
    assert_eq!(client.get_passkey_count(), 2);
    client.remove_passkey(&cred1);
    assert_eq!(client.get_passkey_count(), 1);
    assert_eq!(client.get_passkey(&cred1), None);
    assert_eq!(client.get_passkey(&cred2), Some(pk2));

    // Configure recovery signer, then verify Recovery auth works
    let recovery = Address::generate(&env);
    client.set_recovery_signer(&Some(recovery.clone()));
    assert_eq!(client.get_recovery_signer(), Some(recovery));

    let payload_hash: Hash<32> = env.crypto().sha256(&Bytes::from_slice(&env, b"recover-me"));
    env.as_contract(&contract_id, || {
        let res = PasskeyAccountContract::__check_auth(
            env.clone(),
            payload_hash,
            AccountSignature::Recovery,
            Vec::new(&env),
        );
        assert_eq!(res, Ok(()));
    });
}

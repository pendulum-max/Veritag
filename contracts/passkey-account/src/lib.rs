#![no_std]

use soroban_sdk::{
    auth::{Context, CustomAccountInterface},
    contract, contracterror, contractimpl, contracttype,
    crypto::Hash,
    Address, Bytes, BytesN, Env, Vec,
};

const INSTANCE_LIFETIME_THRESHOLD: u32 = 17_280;
const INSTANCE_BUMP_AMOUNT: u32 = 518_400;

const B64URL_ALPHABET: &[u8; 64] =
    b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum AccountError {
    UnknownCredential = 1,
    InvalidAuthenticatorData = 2,
    UserNotPresent = 3,
    ChallengeMismatch = 4,
    RecoveryNotConfigured = 5,
    CannotRemoveLastAuthMethod = 6,
    InvalidPublicKey = 7,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WebAuthnCredential {
    pub credential_id: Bytes,
    pub authenticator_data: Bytes,
    pub client_data_json: Bytes,
    pub signature: BytesN<64>,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
#[allow(clippy::large_enum_variant)]
pub enum AccountSignature {
    WebAuthn(WebAuthnCredential),
    Recovery,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Passkey(Bytes),
    PasskeyCount,
    RecoverySigner,
    Nonce,
}

/// Encodes a 32-byte array into a 43-byte unpadded RFC 4648 base64url string.
pub fn encode_base64url_32(input: &[u8; 32]) -> [u8; 43] {
    let mut out = [0u8; 43];
    let mut i = 0usize;
    let mut j = 0usize;
    while i < 30 {
        let b0 = input[i] as usize;
        let b1 = input[i + 1] as usize;
        let b2 = input[i + 2] as usize;
        out[j] = B64URL_ALPHABET[b0 >> 2];
        out[j + 1] = B64URL_ALPHABET[((b0 & 0x03) << 4) | (b1 >> 4)];
        out[j + 2] = B64URL_ALPHABET[((b1 & 0x0f) << 2) | (b2 >> 6)];
        out[j + 3] = B64URL_ALPHABET[b2 & 0x3f];
        i += 3;
        j += 4;
    }
    let b30 = input[30] as usize;
    let b31 = input[31] as usize;
    out[40] = B64URL_ALPHABET[b30 >> 2];
    out[41] = B64URL_ALPHABET[((b30 & 0x03) << 4) | (b31 >> 4)];
    out[42] = B64URL_ALPHABET[(b31 & 0x0f) << 2];
    out
}

/// Computes the expected 32-byte challenge digest incorporating the current sequential `nonce`:
/// `SHA-256(signature_payload || nonce.to_be_bytes())`.
pub fn compute_challenge_digest(env: &Env, signature_payload: &Hash<32>, nonce: u64) -> [u8; 32] {
    let mut preimage = Bytes::from_array(env, &signature_payload.to_array());
    preimage.extend_from_array(&nonce.to_be_bytes());
    env.crypto().sha256(&preimage).to_array()
}

fn contains_challenge_field(client_data_json: &Bytes, expected_b64: &[u8; 43]) -> bool {
    // Pattern: `"challenge":"<43-bytes>"` (total 57 bytes)
    let prefix = b"\"challenge\":\"";
    let pattern_len = prefix.len() + 43 + 1; // 13 + 43 + 1 = 57
    let json_len = client_data_json.len() as usize;
    if json_len < pattern_len {
        return false;
    }

    let mut pattern = [0u8; 57];
    pattern[..13].copy_from_slice(prefix);
    pattern[13..56].copy_from_slice(expected_b64);
    pattern[56] = b'"';

    let max_start = json_len - pattern_len;
    let mut start = 0usize;
    while start <= max_start {
        let mut matched = true;
        let mut k = 0usize;
        while k < pattern_len {
            if client_data_json.get((start + k) as u32) != Some(pattern[k]) {
                matched = false;
                break;
            }
            k += 1;
        }
        if matched {
            return true;
        }
        start += 1;
    }
    false
}

#[contract]
pub struct PasskeyAccountContract;

#[contractimpl]
impl PasskeyAccountContract {
    pub fn __constructor(
        env: Env,
        credential_id: Bytes,
        public_key: BytesN<65>,
        recovery: Option<Address>,
    ) {
        if public_key.get(0) != Some(0x04) {
            panic!("invalid uncompressed SEC1 public key prefix");
        }
        env.storage()
            .instance()
            .set(&DataKey::Passkey(credential_id), &public_key);
        env.storage().instance().set(&DataKey::PasskeyCount, &1u32);
        env.storage().instance().set(&DataKey::Nonce, &0u64);
        if let Some(rec) = recovery {
            env.storage().instance().set(&DataKey::RecoverySigner, &rec);
        }
        env.storage()
            .instance()
            .extend_ttl(INSTANCE_LIFETIME_THRESHOLD, INSTANCE_BUMP_AMOUNT);
    }

    pub fn add_passkey(
        env: Env,
        credential_id: Bytes,
        public_key: BytesN<65>,
    ) -> Result<(), AccountError> {
        env.current_contract_address().require_auth();
        if public_key.get(0) != Some(0x04) {
            return Err(AccountError::InvalidPublicKey);
        }
        let key = DataKey::Passkey(credential_id);
        let is_new = !env.storage().instance().has(&key);
        env.storage().instance().set(&key, &public_key);
        if is_new {
            let count: u32 = env
                .storage()
                .instance()
                .get(&DataKey::PasskeyCount)
                .unwrap_or(0);
            env.storage()
                .instance()
                .set(&DataKey::PasskeyCount, &(count + 1));
        }
        env.storage()
            .instance()
            .extend_ttl(INSTANCE_LIFETIME_THRESHOLD, INSTANCE_BUMP_AMOUNT);
        Ok(())
    }

    pub fn remove_passkey(env: Env, credential_id: Bytes) -> Result<(), AccountError> {
        env.current_contract_address().require_auth();
        let key = DataKey::Passkey(credential_id);
        if !env.storage().instance().has(&key) {
            return Err(AccountError::UnknownCredential);
        }
        let count: u32 = env
            .storage()
            .instance()
            .get(&DataKey::PasskeyCount)
            .unwrap_or(1);
        let has_recovery = env.storage().instance().has(&DataKey::RecoverySigner);
        if count <= 1 && !has_recovery {
            return Err(AccountError::CannotRemoveLastAuthMethod);
        }
        env.storage().instance().remove(&key);
        env.storage()
            .instance()
            .set(&DataKey::PasskeyCount, &count.saturating_sub(1));
        env.storage()
            .instance()
            .extend_ttl(INSTANCE_LIFETIME_THRESHOLD, INSTANCE_BUMP_AMOUNT);
        Ok(())
    }

    pub fn set_recovery_signer(env: Env, recovery: Option<Address>) -> Result<(), AccountError> {
        env.current_contract_address().require_auth();
        let count: u32 = env
            .storage()
            .instance()
            .get(&DataKey::PasskeyCount)
            .unwrap_or(0);
        if recovery.is_none() && count == 0 {
            return Err(AccountError::CannotRemoveLastAuthMethod);
        }
        match recovery {
            Some(addr) => env
                .storage()
                .instance()
                .set(&DataKey::RecoverySigner, &addr),
            None => env.storage().instance().remove(&DataKey::RecoverySigner),
        }
        env.storage()
            .instance()
            .extend_ttl(INSTANCE_LIFETIME_THRESHOLD, INSTANCE_BUMP_AMOUNT);
        Ok(())
    }

    pub fn get_passkey(env: Env, credential_id: Bytes) -> Option<BytesN<65>> {
        env.storage()
            .instance()
            .get(&DataKey::Passkey(credential_id))
    }

    pub fn get_passkey_count(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::PasskeyCount)
            .unwrap_or(0)
    }

    pub fn get_recovery_signer(env: Env) -> Option<Address> {
        env.storage().instance().get(&DataKey::RecoverySigner)
    }

    /// Returns the current sequential execution nonce for replay protection.
    pub fn get_nonce(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::Nonce)
            .unwrap_or(0u64)
    }
}

#[contractimpl]
impl CustomAccountInterface for PasskeyAccountContract {
    type Signature = AccountSignature;
    type Error = AccountError;

    #[allow(non_snake_case)]
    fn __check_auth(
        env: Env,
        signature_payload: Hash<32>,
        signature: Self::Signature,
        _auth_contexts: Vec<Context>,
    ) -> Result<(), Self::Error> {
        env.storage()
            .instance()
            .extend_ttl(INSTANCE_LIFETIME_THRESHOLD, INSTANCE_BUMP_AMOUNT);

        let current_nonce: u64 = env
            .storage()
            .instance()
            .get(&DataKey::Nonce)
            .unwrap_or(0u64);

        match signature {
            AccountSignature::Recovery => {
                let recovery: Address = env
                    .storage()
                    .instance()
                    .get(&DataKey::RecoverySigner)
                    .ok_or(AccountError::RecoveryNotConfigured)?;
                recovery.require_auth();
                env.storage()
                    .instance()
                    .set(&DataKey::Nonce, &(current_nonce + 1));
                Ok(())
            }
            AccountSignature::WebAuthn(cred) => {
                let public_key: BytesN<65> = env
                    .storage()
                    .instance()
                    .get(&DataKey::Passkey(cred.credential_id))
                    .ok_or(AccountError::UnknownCredential)?;

                // Authenticator data must be at least 37 bytes (32 rpIdHash + 1 flags + 4 signCount)
                if cred.authenticator_data.len() < 37 {
                    return Err(AccountError::InvalidAuthenticatorData);
                }

                // Byte 32 is flags; bit 0 (0x01) is User Present (UP)
                let flags = cred
                    .authenticator_data
                    .get(32)
                    .ok_or(AccountError::InvalidAuthenticatorData)?;
                if (flags & 0x01) == 0 {
                    return Err(AccountError::UserNotPresent);
                }

                // Verify the nonce-bound challenge digest (or raw payload on initial nonce 0 fallback)
                // appears in clientDataJSON
                let nonce_challenge =
                    compute_challenge_digest(&env, &signature_payload, current_nonce);
                let expected_nonce_b64 = encode_base64url_32(&nonce_challenge);
                if !contains_challenge_field(&cred.client_data_json, &expected_nonce_b64) {
                    return Err(AccountError::ChallengeMismatch);
                }

                // Compute SHA-256(authenticator_data || SHA-256(client_data_json))
                let client_data_hash = env.crypto().sha256(&cred.client_data_json);
                let mut signed_data = cred.authenticator_data.clone();
                signed_data.extend_from_array(&client_data_hash.to_array());
                let message_digest = env.crypto().sha256(&signed_data);

                // Host trap panics on invalid signature
                env.crypto()
                    .secp256r1_verify(&public_key, &message_digest, &cred.signature);

                // Increment sequential nonce monotonically upon successful authorization
                env.storage()
                    .instance()
                    .set(&DataKey::Nonce, &(current_nonce + 1));

                Ok(())
            }
        }
    }
}

#[cfg(test)]
mod test;

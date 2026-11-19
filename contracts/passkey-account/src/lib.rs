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
    NonceExhausted = 8,
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

fn contains_challenge_field(client_data_json: &Bytes, expected_b64: &[u8; 43]) -> bool {
    let prefix = b"\"challenge\":\"";
    let json_len = client_data_json.len() as usize;
    if json_len < prefix.len() + expected_b64.len() + 2 {
        return false;
    }

    // Reject nested JSON object injection by tracking brace depth outside string literals
    let mut depth: i32 = 0;
    let mut in_str = false;
    let mut escaped = false;
    for idx in 0..json_len {
        let b = client_data_json.get(idx as u32).unwrap_or(0);
        if in_str {
            if escaped {
                escaped = false;
            } else if b == b'\\' {
                escaped = true;
            } else if b == b'"' {
                in_str = false;
            }
        } else if b == b'"' {
            in_str = true;
        } else if b == b'{' {
            depth += 1;
            if depth > 1 {
                return false;
            }
        } else if b == b'}' {
            depth -= 1;
            if depth < 0 {
                return false;
            }
        }
    }
    if depth != 0 || in_str {
        return false;
    }

    let mut found = false;
    let mut matches_expected = false;
    for start in 0..=json_len - prefix.len() {
        let matches_prefix = prefix
            .iter()
            .enumerate()
            .all(|(offset, byte)| client_data_json.get((start + offset) as u32) == Some(*byte));
        if !matches_prefix {
            continue;
        }
        // Multiple challenges could let one assertion bind to several nonces.
        if found {
            return false;
        }
        found = true;
        let value_start = start + prefix.len();
        matches_expected = expected_b64.iter().enumerate().all(|(offset, byte)| {
            client_data_json.get((value_start + offset) as u32) == Some(*byte)
        }) && client_data_json.get((value_start + expected_b64.len()) as u32)
            == Some(b'"');
    }
    found && matches_expected
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

    /// Returns the next account authorization nonce.
    /// WebAuthn clients use SHA256(signature_payload || nonce.to_be_bytes()) as the challenge.
    pub fn get_nonce(env: Env) -> u64 {
        env.storage().instance().get(&DataKey::Nonce).unwrap_or(0)
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
        let nonce = Self::get_nonce(env.clone());
        let next_nonce = nonce.checked_add(1).ok_or(AccountError::NonceExhausted)?;
        env.storage()
            .instance()
            .extend_ttl(INSTANCE_LIFETIME_THRESHOLD, INSTANCE_BUMP_AMOUNT);

        match signature {
            AccountSignature::Recovery => {
                let recovery: Address = env
                    .storage()
                    .instance()
                    .get(&DataKey::RecoverySigner)
                    .ok_or(AccountError::RecoveryNotConfigured)?;
                recovery.require_auth();
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

                // Bind the challenge to the current sequential account nonce.
                // The nonce is an unsigned 64 bit integer in big endian byte order.
                let mut challenge_payload = Bytes::from_array(&env, &signature_payload.to_array());
                challenge_payload.extend_from_array(&nonce.to_be_bytes());
                let challenge_digest = env.crypto().sha256(&challenge_payload);
                let expected_b64 = encode_base64url_32(&challenge_digest.to_array());
                if !contains_challenge_field(&cred.client_data_json, &expected_b64) {
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
            }
        }

        // Consume the nonce only after the passkey signature or recovery authorization succeeds.
        env.storage().instance().set(&DataKey::Nonce, &next_nonce);
        Ok(())
    }
}

#[cfg(test)]
mod test;

use soroban_sdk::{xdr::ToXdr, Address, Bytes, BytesN, Env, Vec};

/// Maximum supported Merkle proof depth (supports up to 2^32 units per batch).
pub const MAX_PROOF_DEPTH: u32 = 32;

/// Computes `sha256(data)` as `BytesN<32>`.
pub fn sha256_bytes(env: &Env, data: &Bytes) -> BytesN<32> {
    env.crypto().sha256(data).into()
}

/// Computes `unit_id = sha256(brand_address_xdr || batch_id || serial_hash)`.
///
/// Using `brand.to_xdr(env)` provides canonical domain-separated serialization of the Stellar
/// account or contract address across both Rust Soroban contracts and TypeScript SDK clients.
pub fn compute_unit_id(
    env: &Env,
    brand: &Address,
    batch_id: &BytesN<32>,
    serial_hash: &BytesN<32>,
) -> BytesN<32> {
    let mut payload = brand.to_xdr(env);
    payload.extend_from_array(&batch_id.to_array());
    payload.extend_from_array(&serial_hash.to_array());
    sha256_bytes(env, &payload)
}

/// Computes `leaf = sha256(serial_hash || secret_hash)`.
pub fn compute_leaf(env: &Env, serial_hash: &BytesN<32>, secret_hash: &BytesN<32>) -> BytesN<32> {
    let mut buf = [0u8; 64];
    buf[..32].copy_from_slice(&serial_hash.to_array());
    buf[32..].copy_from_slice(&secret_hash.to_array());
    let bytes = Bytes::from_array(env, &buf);
    sha256_bytes(env, &bytes)
}

/// Computes sorted-pair internal node `sha256(min(a, b) || max(a, b))`.
///
/// Sorting sibling pairs eliminates the need to pass directional left/right index vectors
/// alongside `proof: Vec<BytesN<32>>`.
pub fn hash_pair(env: &Env, a: &BytesN<32>, b: &BytesN<32>) -> BytesN<32> {
    let a_arr = a.to_array();
    let b_arr = b.to_array();
    let mut buf = [0u8; 64];
    if a_arr <= b_arr {
        buf[..32].copy_from_slice(&a_arr);
        buf[32..].copy_from_slice(&b_arr);
    } else {
        buf[..32].copy_from_slice(&b_arr);
        buf[32..].copy_from_slice(&a_arr);
    }
    let bytes = Bytes::from_array(env, &buf);
    sha256_bytes(env, &bytes)
}

/// Verifies that `leaf` belongs to the Merkle tree rooted at `merkle_root` using `proof`.
pub fn verify_proof(
    env: &Env,
    merkle_root: &BytesN<32>,
    leaf: &BytesN<32>,
    proof: &Vec<BytesN<32>>,
) -> bool {
    if proof.len() > MAX_PROOF_DEPTH {
        return false;
    }

    let mut computed = leaf.clone();
    for sibling in proof.iter() {
        computed = hash_pair(env, &computed, &sibling);
    }
    computed == *merkle_root
}

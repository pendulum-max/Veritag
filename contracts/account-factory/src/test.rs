use super::*;

const PASSKEY_ACCOUNT_WASM: &[u8] =
    include_bytes!("../../../target/wasm32v1-none/release/passkey_account.wasm");

#[test]
fn test_deterministic_address_prediction_and_deployment() {
    let env = Env::default();
    let wasm_hash = env.deployer().upload_contract_wasm(PASSKEY_ACCOUNT_WASM);
    let factory_id = env.register(AccountFactoryContract, (wasm_hash.clone(),));
    let client = AccountFactoryContractClient::new(&env, &factory_id);

    assert_eq!(client.get_wasm_hash(), Some(wasm_hash));

    let salt_a = BytesN::from_array(&env, &[0xaa; 32]);
    let salt_b = BytesN::from_array(&env, &[0xbb; 32]);

    let predicted_a = client.get_address(&salt_a);
    let predicted_b = client.get_address(&salt_b);
    assert_ne!(predicted_a, predicted_b);
    assert!(!client.is_deployed(&salt_a));

    let cred_id = Bytes::from_slice(&env, b"cred-factory-01");
    let mut pubkey_arr = [0x11u8; 65];
    pubkey_arr[0] = 0x04;
    let pubkey = BytesN::from_array(&env, &pubkey_arr);

    let deployed_a = client.deploy(&salt_a, &cred_id, &pubkey, &None);
    assert_eq!(deployed_a, predicted_a);
    assert!(client.is_deployed(&salt_a));

    // Idempotent re-deploy returns the same address without failing
    let deployed_again = client.deploy(&salt_a, &cred_id, &pubkey, &None);
    assert_eq!(deployed_again, predicted_a);
}

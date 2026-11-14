use super::*;
use soroban_sdk::testutils::{Address as _, MockAuth, MockAuthInvoke};
use soroban_sdk::IntoVal;

const PASSKEY_ACCOUNT_WASM: &[u8] =
    include_bytes!("../../../target/wasm32v1-none/release/passkey_account.wasm");

#[test]
fn test_deterministic_address_prediction_and_deployment() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let wasm_hash = env.deployer().upload_contract_wasm(PASSKEY_ACCOUNT_WASM);
    let factory_id = env.register(AccountFactoryContract, (wasm_hash.clone(), admin.clone()));
    let client = AccountFactoryContractClient::new(&env, &factory_id);

    assert_eq!(client.get_wasm_hash(), Some(wasm_hash));
    assert_eq!(client.get_admin(), Some(admin));

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

#[test]
fn test_upgrade_wasm_hash() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let non_admin = Address::generate(&env);
    let new_admin = Address::generate(&env);

    let initial_hash = BytesN::from_array(&env, &[0x11; 32]);
    let upgraded_wasm_hash = env.deployer().upload_contract_wasm(PASSKEY_ACCOUNT_WASM);

    let factory_id = env.register(
        AccountFactoryContract,
        (initial_hash.clone(), admin.clone()),
    );
    let client = AccountFactoryContractClient::new(&env, &factory_id);

    assert_eq!(client.get_wasm_hash(), Some(initial_hash.clone()));

    // Non-admin authorization attempt must fail
    let unauthorized_attempt = client
        .mock_auths(&[MockAuth {
            address: &non_admin,
            invoke: &MockAuthInvoke {
                contract: &factory_id,
                fn_name: "set_account_wasm_hash",
                args: (upgraded_wasm_hash.clone(),).into_val(&env),
                sub_invokes: &[],
            },
        }])
        .try_set_account_wasm_hash(&upgraded_wasm_hash);
    assert!(unauthorized_attempt.is_err());
    assert_eq!(client.get_wasm_hash(), Some(initial_hash));

    // Authorized admin updates WASM hash
    env.mock_all_auths();
    client.set_account_wasm_hash(&upgraded_wasm_hash);
    assert_eq!(client.get_wasm_hash(), Some(upgraded_wasm_hash.clone()));

    // Admin rotation works and persists new admin
    client.set_admin(&new_admin);
    assert_eq!(client.get_admin(), Some(new_admin));

    // Subsequent deploy uses the upgraded WASM hash
    let salt = BytesN::from_array(&env, &[0xcc; 32]);
    let cred_id = Bytes::from_slice(&env, b"cred-upgraded-01");
    let mut pubkey_arr = [0x22u8; 65];
    pubkey_arr[0] = 0x04;
    let pubkey = BytesN::from_array(&env, &pubkey_arr);

    let predicted = client.get_address(&salt);
    let deployed = client.deploy(&salt, &cred_id, &pubkey, &None);
    assert_eq!(deployed, predicted);
    assert!(client.is_deployed(&salt));
}

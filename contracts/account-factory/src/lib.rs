#![no_std]

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, Address, Bytes, BytesN, Env,
};

const INSTANCE_LIFETIME_THRESHOLD: u32 = 17_280;
const INSTANCE_BUMP_AMOUNT: u32 = 518_400;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum FactoryError {
    NotInitialized = 1,
    InvalidPublicKey = 2,
    NotAuthorized = 3,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum FactoryDataKey {
    AccountWasmHash,
    Admin,
    DeployedBySalt(BytesN<32>),
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WasmHashUpdated {
    #[topic]
    pub admin: Address,
    pub old_wasm_hash: BytesN<32>,
    pub new_wasm_hash: BytesN<32>,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AdminUpdated {
    #[topic]
    pub old_admin: Address,
    #[topic]
    pub new_admin: Address,
}

#[contract]
pub struct AccountFactoryContract;

#[contractimpl]
impl AccountFactoryContract {
    pub fn __constructor(env: Env, account_wasm_hash: BytesN<32>, admin: Address) {
        env.storage()
            .instance()
            .set(&FactoryDataKey::AccountWasmHash, &account_wasm_hash);
        env.storage()
            .instance()
            .set(&FactoryDataKey::Admin, &admin);
        env.storage()
            .instance()
            .extend_ttl(INSTANCE_LIFETIME_THRESHOLD, INSTANCE_BUMP_AMOUNT);
    }

    /// Updates the PasskeyAccount WASM hash used for future deployments (admin only).
    pub fn set_account_wasm_hash(
        env: Env,
        new_wasm_hash: BytesN<32>,
    ) -> Result<(), FactoryError> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&FactoryDataKey::Admin)
            .ok_or(FactoryError::NotInitialized)?;
        admin.require_auth();

        let old_wasm_hash: BytesN<32> = env
            .storage()
            .instance()
            .get(&FactoryDataKey::AccountWasmHash)
            .ok_or(FactoryError::NotInitialized)?;

        env.storage()
            .instance()
            .set(&FactoryDataKey::AccountWasmHash, &new_wasm_hash);
        env.storage()
            .instance()
            .extend_ttl(INSTANCE_LIFETIME_THRESHOLD, INSTANCE_BUMP_AMOUNT);

        WasmHashUpdated {
            admin,
            old_wasm_hash,
            new_wasm_hash,
        }
        .publish(&env);

        Ok(())
    }

    /// Alias for [`set_account_wasm_hash`] to support WASM hash upgrade workflows.
    pub fn upgrade_account_wasm_hash(
        env: Env,
        new_wasm_hash: BytesN<32>,
    ) -> Result<(), FactoryError> {
        Self::set_account_wasm_hash(env, new_wasm_hash)
    }

    /// Rotates the factory administrator address (current admin only).
    pub fn set_admin(env: Env, new_admin: Address) -> Result<(), FactoryError> {
        let old_admin: Address = env
            .storage()
            .instance()
            .get(&FactoryDataKey::Admin)
            .ok_or(FactoryError::NotInitialized)?;
        old_admin.require_auth();

        env.storage()
            .instance()
            .set(&FactoryDataKey::Admin, &new_admin);
        env.storage()
            .instance()
            .extend_ttl(INSTANCE_LIFETIME_THRESHOLD, INSTANCE_BUMP_AMOUNT);

        AdminUpdated {
            old_admin,
            new_admin,
        }
        .publish(&env);

        Ok(())
    }

    /// Returns the configured factory administrator address.
    pub fn get_admin(env: Env) -> Option<Address> {
        env.storage().instance().get(&FactoryDataKey::Admin)
    }

    /// Deterministically deploys a PasskeyAccountContract instance for `salt` or returns
    /// the existing address if already deployed by this factory.
    pub fn deploy(
        env: Env,
        salt: BytesN<32>,
        credential_id: Bytes,
        public_key: BytesN<65>,
        recovery: Option<Address>,
    ) -> Result<Address, FactoryError> {
        if public_key.get(0) != Some(0x04) {
            return Err(FactoryError::InvalidPublicKey);
        }
        env.storage()
            .instance()
            .extend_ttl(INSTANCE_LIFETIME_THRESHOLD, INSTANCE_BUMP_AMOUNT);

        let salt_key = FactoryDataKey::DeployedBySalt(salt.clone());
        if let Some(existing) = env.storage().persistent().get::<_, Address>(&salt_key) {
            return Ok(existing);
        }

        let wasm_hash: BytesN<32> = env
            .storage()
            .instance()
            .get(&FactoryDataKey::AccountWasmHash)
            .ok_or(FactoryError::NotInitialized)?;

        let deployed = env
            .deployer()
            .with_current_contract(salt)
            .deploy_v2(wasm_hash, (credential_id, public_key, recovery));

        env.storage().persistent().set(&salt_key, &deployed);
        env.storage().persistent().extend_ttl(
            &salt_key,
            INSTANCE_LIFETIME_THRESHOLD,
            INSTANCE_BUMP_AMOUNT,
        );

        Ok(deployed)
    }

    /// Computes the deterministic contract address for `salt` without deploying.
    pub fn get_address(env: Env, salt: BytesN<32>) -> Address {
        env.deployer()
            .with_current_contract(salt)
            .deployed_address()
    }

    /// Returns whether a wallet has already been deployed for `salt`.
    pub fn is_deployed(env: Env, salt: BytesN<32>) -> bool {
        env.storage()
            .persistent()
            .has(&FactoryDataKey::DeployedBySalt(salt))
    }

    pub fn get_wasm_hash(env: Env) -> Option<BytesN<32>> {
        env.storage()
            .instance()
            .get(&FactoryDataKey::AccountWasmHash)
    }
}

#[cfg(test)]
mod test;

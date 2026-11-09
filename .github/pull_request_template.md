## Summary

Briefly describe the changes introduced in this Pull Request and link the related issue (e.g., `Closes #...`).

## Packages Modified
- [ ] `contracts/` (Soroban Rust Smart Contracts)
- [ ] `packages/sdk` (`@veritag/sdk`)
- [ ] `backend/` (`@veritag/backend`)
- [ ] `indexer/` (`@veritag/indexer`)
- [ ] `web/` (`@veritag/web`)
- [ ] `docs/` / CI / Tooling

## Verification Checklist
- [ ] `cargo test --workspace` and `cargo clippy --workspace --all-targets -- -D warnings` pass (if contracts changed)
- [ ] `pnpm test` passes across all packages
- [ ] `pnpm lint` (`tsc --noEmit`) passes with zero errors
- [ ] Added or updated unit/integration tests covering the changes

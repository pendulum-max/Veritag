# Veritag — Drips Stellar Wave Contributors

Welcome to the Veritag contributor recognition page for the **Drips Stellar Wave** program. This page tracks open-source contributors who close issues tagged with the `drips-wave` label and are eligible for continuous funding through the Drips protocol on the Stellar blockchain.

---

## About the Drips Stellar Wave Program

[Drips](https://www.drips.network/) is a protocol for continuous, on-chain open-source funding. Veritag participates in the **Stellar Wave** by allocating a portion of its funding stream to contributors who resolve issues labeled `drips-wave` in this repository.

When a contributor merges a pull request that closes a qualifying issue, they are recorded in this leaderboard and become eligible to receive their proportional share of the wave's USDC funding, distributed on-chain via the Drips protocol on Stellar.

---

## Reward Allocation

Rewards are denominated in USDC equivalent and vary by issue category:

| Category | Label | Reward per Merged PR |
|---|---|---|
| Feature | `[feature]` | 200 USDC |
| DevOps | `[devops]` | 150 USDC |
| Bug Fix | `[bug]` | 125 USDC |
| Scripts | `[scripts]` | 100 USDC |
| Documentation | `[docs]` | 75 USDC |
| Other | *(unlabeled)* | 50 USDC |

**Bonuses:**
- PRs that close **2 qualifying issues**: +25 USDC bonus
- PRs that close **3 or more qualifying issues**: +50 USDC bonus

Reward amounts are estimates based on the wave allocation at the time of merge and are subject to change between waves.

---

## Contribution Guidelines

1. **Fork** this repository and create a feature branch from `main`.
2. **Pick an issue** labeled `drips-wave` from the [issue tracker](https://github.com/pendulum-max/Veritag/issues?q=is%3Aopen+label%3Adrips-wave).
3. **Open a pull request** that references the issue number in the PR description (e.g. `Closes #125`).
4. **Ensure all tests pass** — the CI pipeline must be green before review.
5. **Await review** from a maintainer. Address any requested changes promptly.
6. Once merged, your contribution will appear in the leaderboard on the following Monday.

> **Note:** Only PRs that close an issue bearing the `drips-wave` label at the time of merge are counted toward wave rewards.

---

## Current Wave Leaderboard

> Updated automatically every Monday by GitHub Actions.

| Rank | GitHub Username | PRs Merged | Tasks Completed | Estimated Reward |
|---|---|---|---|---|
| — | *No contributions yet* | — | — | — |

---

## Wave Tasks

Recent and open tasks eligible for Drips Stellar Wave rewards:

| Issue # | Title | Category | Status | Contributor |
|---|---|---|---|---|
| [#122](https://github.com/pendulum-max/Veritag/issues/122) | *(Issue #122)* | — | Open | — |
| [#123](https://github.com/pendulum-max/Veritag/issues/123) | *(Issue #123)* | — | Open | — |
| [#124](https://github.com/pendulum-max/Veritag/issues/124) | *(Issue #124)* | — | Open | — |
| [#125](https://github.com/pendulum-max/Veritag/issues/125) | Drips Wave contributor recognition page, leaderboard script, and GitHub Actions workflow | `[devops]` `[docs]` | Open | — |

---

## How Drips Funding Works

Veritag maintains a Drips stream funded with USDC on the Stellar network. At the end of each wave period, the smart contract calculates each eligible contributor's share based on the reward points they accumulated during the wave.

Contributors must have a Stellar wallet address registered to claim their funds. Unclaimed funds roll over into the next wave. The full Drips protocol documentation explains how to register a wallet and claim your rewards.

For questions about the wave program, open a GitHub Discussion or reach out in the project's community channels.

---

*Powered by [Drips](https://www.drips.network/) — continuous funding for open-source contributors.*

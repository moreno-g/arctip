# Security

ArcTip handles money. If you find something, please report it privately before
disclosing it publicly.

**Contact:** DM [@Arctipxyz](https://x.com/Arctipxyz) on X.

## Scope

- `contracts/contracts/TipJar.sol` — the deployed contract
- `website/js/` — the app that builds and signs transactions

## Known and accepted

**`register()` can be front-run.** The handle sits in the mempool in the clear,
so anyone watching can copy it and outbid the gas price to take the name first.
The fix is a commit-reveal scheme, which doubles the transactions on the flow
that most needs to be frictionless. The trade is deliberate while handles carry
little value, and is worth revisiting as that changes.

**The owner can change the fee, within a 5% hard cap.** Tips carry a `maxFeeBps`
so a fee raised between quote and signature reverts rather than overcharging.

## Not in scope

- Third-party browser extensions or external RPC infrastructure issues.


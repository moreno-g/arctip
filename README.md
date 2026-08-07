# ArcTip

A tip link for creators, settled in USDC on [Arc](https://arc.io). One link —
`arctip.xyz/@handle` — that fans use to send USDC, which lands in the creator's
wallet in about a second.

**Live on Arc testnet:** [arctip.xyz](https://arctip.xyz)

```
contracts/   Solidity (Hardhat) — the TipJar contract, tests, deploy script
website/     the static site and app, no build step
```

## Why Arc

USDC is the native gas asset there. Every other chain forces "first buy our
token so you can pay the fee," which is the step where crypto tipping flows die.
Here the fan holds USDC, tips USDC, and pays gas in USDC.

## How it works

1. A creator connects a wallet and claims a handle (`register`)
2. They share `arctip.xyz/@handle`, or the QR code and share card generated for them
3. A fan picks an amount and confirms (`tip`)
4. The contract splits the payment: the creator's share goes straight to their
   wallet, the fee to the treasury

## Deployment

| | |
|---|---|
| Network | Arc Testnet (chain `5042002`) |
| TipJar | [`0x9BE91953aE20c079F8Ad932Ef6CF812f80aD217a`](https://testnet.arcscan.app/address/0x9BE91953aE20c079F8Ad932Ef6CF812f80aD217a) |
| Fee | 2% |

See [`contracts/deployments/arcTestnet.json`](contracts/deployments/arcTestnet.json).

## Working on it

```bash
cd contracts && npm install && npx hardhat test
cd website  && npx vercel --prod     # root directory must be "website"
```

The contract address lives in [`website/js/config.js`](website/js/config.js) and
must be updated after any redeploy.

## Status

Testnet. ArcTip is live on Arc Testnet using USDC for native value settlement.

ArcTip is an independent project built on Arc. It is not affiliated with Circle.


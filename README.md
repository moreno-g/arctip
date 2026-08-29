# ArcTip

A tip link for creators, settled in USDC on [Arc](https://arc.io). One link —
`arctip.app/@handle` — that fans use to send USDC, which lands in the creator's
wallet in about a second.

**Live on Arc testnet:** [arctip.app](https://arctip.app)

```
contracts/   Solidity (Hardhat) — TipJar, ArcTipPaymaster, tests, deploy scripts
website/     the static site and app, no build step
tools/       one-off build for the vendored Circle SDK bundle
```

## Why Arc

USDC is the native gas asset there. Every other chain forces "first buy our
token so you can pay the fee," which is the step where crypto tipping flows die.
Here the fan holds USDC, tips USDC, and pays gas in USDC.

## How it works

1. A creator connects a wallet — or makes one from a passkey — and claims a
   handle (`register`)
2. They share `arctip.app/@handle`, or the QR code and share card generated for them
3. A fan picks an amount and confirms (`tip`)
4. The contract splits the payment: the creator's share goes straight to their
   wallet, the fee to the treasury

## Sponsored gas

Arc already removes the usual "buy the gas token first" problem. Two narrower
versions of it survive, and both kill the flow:

- a wallet created from a passkey seconds ago holds exactly zero
- a fan holding exactly 5 USDC cannot send a 5 USDC tip, because some has to
  stay behind for gas — and the round number is the whole product

`ArcTipPaymaster` (ERC-4337 v0.7) sponsors those, and pays for it out of the
fees rather than a budget:

| | measured on Arc testnet at 21 gwei |
|---|---|
| `tip()` alone | 66–99k gas |
| sponsored through ERC-4337 | ~186k gas ≈ **0.0039 USDC** |
| 2% fee on a 1 USDC tip | **0.02 USDC** — about 5× the gas |
| break-even tip | **0.196 USDC** |

That break-even is where `minSponsoredTip` (0.25 USDC) comes from. Below it a fan
pays their own gas, which on Arc they already can. The floor is also the
anti-drain measure: sponsorship is open to anyone, so it has to survive somebody
tipping their own handle in a loop — each round trip costs the attacker the 2%
fee and costs us less than that in gas.

The paymaster only ever sponsors `tip`. It refuses `register`, which is free to
call and would otherwise let anyone mint handles until the deposit ran dry.

## Passkey wallets

Fans arrive from a bio link without a wallet and will not install one to send
five dollars. [Circle Modular Wallets](https://developers.circle.com/wallets/modular)
turn a passkey into an ERC-4337 smart account on Arc — no extension, no seed
phrase.

Arc has **no P-256 precompile** (neither `0x100` nor `0x0b` is deployed), so
verifying a WebAuthn signature ourselves on-chain would be prohibitive. Circle's
account does it instead, which is why this path uses their SDK rather than a
hand-rolled one.

The SDK is npm-only, and `website/` is deliberately build-free. So it is bundled
once into `website/vendor/circle-passkey.js` and committed, the same way
`ethers.umd.min.js` and `qrcode.min.js` got there. Rebuild it with:

```bash
node tools/circle-bundle/build.js
```

The site loads it lazily — only when a fan actually chooses the passkey path,
never on page load.

## Arriving from another chain

Arc exposes an ERC-20 view of the native balance at
`0x3600000000000000000000000000000000000000` — the same money at two scales
(18 decimals native, 6 through the ERC-20, a factor of 10¹²). Verified on
testnet: a wallet holding `20.003934385861338112` natively reads `20.003934`
there.

That means CCTP needs no wrapper and no contract of ours. USDC bridged to Arc
lands in the recipient's native balance, spendable as both the tip and its gas.
Arc testnet is CCTP domain **26**; there is no published Arc mainnet domain yet.

## Deployment

| | |
|---|---|
| Network | Arc Testnet (chain `5042002`) |
| TipJar | [`0x9BE91953aE20c079F8Ad932Ef6CF812f80aD217a`](https://testnet.arcscan.app/address/0x9BE91953aE20c079F8Ad932Ef6CF812f80aD217a) |
| ArcTipPaymaster | not yet deployed |
| EntryPoint (v0.7) | `0x0000000071727De22E5E9d8BAf0edAc6f37da032` — confirmed live on Arc |
| Fee | 2% |

See [`contracts/deployments/arcTestnet.json`](contracts/deployments/arcTestnet.json).

## Working on it

```bash
cd contracts && npm install && npm test     # 51 tests
```

Deploying the paymaster, once `TipJar` is live:

```bash
cd contracts
TIPJAR_ADDRESS=0x… OWNER_ADDRESS=0x… npx hardhat run scripts/deploy-paymaster.js --network arcTestnet
```

It deploys, stakes with the EntryPoint (required — the paymaster reads its own
storage while validating, and bundlers reject unstaked paymasters that do),
funds the deposit, and hands ownership over. It then reports whether `TipJar`'s
treasury still needs pointing at the paymaster, without which the fees never
reach the thing they fund.

Contract addresses live in [`website/js/config.js`](website/js/config.js) and
must be updated after any redeploy.

## Publishing the site

The site is served by **Vercel** from the `website/` directory, in the `arctip`
project under the `moreno-g` team, and the deploy is **manual** — nothing
publishes on a push to `main`:

```bash
cd website && npx vercel --prod
```

Because it is manual, the live site drifts behind the repo whenever the command
is forgotten. It has done so before, and expensively: the `$TIP` section was
removed from the repo and stayed live for months afterwards.

The domain is registered at **Namecheap**, and its DNS stays there rather than
being delegated to Vercel — two records point at the host (`A @ → 76.76.21.21`,
`CNAME www → cname.vercel-dns.com`). Keeping registrar, DNS and hosting on
separate accounts is deliberate; see below for why.

**`arctip.xyz` is lost.** It was bought on 25 July 2026 through a Vercel account
whose login could not be recovered; the domain, its DNS and the original project
all live there, so the old page — `$TIP` section included — cannot be corrected
and stays up until the domain expires on 25 July 2027. Do not reference
`arctip.xyz` anywhere. `arctip.app` replaces it.

`website/vercel.json` is **not** a leftover. It carries the `/@:handle` rewrite
that serves `tip.html`, which is the entire share-link surface of the product —
without it every creator link 404s.

`railway.json` was a leftover, and is gone: the Railway project was deleted on
28 August 2026 and the site never flinched, because Railway had never served it.
`server.js` stays as the local dev server behind `npm start`.

## Status

Testnet. Arc mainnet opens 16 September 2026.

ArcTip is an independent project built on Arc. It is not affiliated with Circle.

# ArcTip

Lien de pourboire créateur réglé en **USDC sur Arc** : `arctip.xyz/@handle`. Le contrat `TipJar`
répartit le paiement, la part créateur part directement dans son wallet. `ArcTipPaymaster`
sponsorise le gas du fan et se rembourse sur les frais.

Live sur **Arc testnet** → [arctip.xyz](https://arctip.xyz). **Mainnet Arc : 16 septembre 2026.**

```
contracts/   Solidity (Hardhat) — TipJar, ArcTipPaymaster, interfaces/, mocks/, tests, scripts
website/     site + app statiques, aucune étape de build
tools/       build ponctuel du bundle Circle vendoré (npm isolé ici, pas dans website/)
server.js    serveur statique node:http qui sert website/ (pour Railway)
```

## Commandes

```
npm start                     # node server.js — sert website/, port 8080
npm test                      # 51 tests (délègue à contracts/)
node tools/circle-bundle/build.js   # régénère website/vendor/circle-passkey.js
```

## Règles propres à ce repo

- **`contracts/` est un sous-projet CommonJS avec des dépendances npm assumées** (Hardhat,
  OpenZeppelin, dotenv). La racine et `website/` restent en zéro dépendance / ESM.
- **`tools/circle-bundle/` est la seule autre exception npm**, et elle est délibérée : le SDK
  Circle Modular Wallets n'existe qu'en npm. Il est bundlé **une fois** vers
  `website/vendor/circle-passkey.js` et committé, comme `ethers.umd.min.js` avant lui. `website/`
  reste sans étape de build : le bundle n'est régénéré que si le SDK change.
- Le site est **sans étape de build** : pas de bundler, pas de framework. Éditer `website/`
  directement.
- Argument produit central : sur Arc, l'USDC est l'actif de gas natif — le fan détient de l'USDC,
  tippe en USDC, paie le gas en USDC. Pas de « achetez d'abord notre token ». Ne pas introduire
  d'étape qui casse ça.
- **Pas de token ArcTip, et aucun prévu.** Un token de gouvernance/cashback sur un tip jar
  déssert le dossier Circle. Ne pas le réintroduire.
- Les polices sont **auto-hébergées** dans `website/fonts/` (woff2). Ne pas repasser sur un CDN.
- **Ne rien annoncer sur le site qui n'existe pas dans le code.** Un commit précédent avait mis en
  page un faux bouton « Circle Social Login » et un contrat CCTP non fonctionnel ; c'est le risque
  le plus sérieux pour un dossier de grant. Les cartes de la section Circle portent un
  `status-tag` (`is-live` / `is-building`) — le tenir à jour.
- **Contraste AA obligatoire.** `--gold-600` échoue (4.0:1) sur les panneaux `--mist-100` ;
  utiliser `--gold-700` (5.3:1) là. Vérifier avant d'introduire une couleur de texte.

## Faits Arc vérifiés on-chain

À ne pas re-deviner — mesurés sur le testnet, pas lus dans une doc :

- **EntryPoints ERC-4337 v0.6, v0.7 et v0.8 : tous déployés.** v0.7 =
  `0x0000000071727De22E5E9d8BAf0edAc6f37da032`.
- **Aucune précompile P-256** (ni `0x100` ni `0x0b`) → vérifier une signature WebAuthn nous-mêmes
  on-chain est hors de prix. C'est la raison d'être du SDK Circle ici.
- **`0x3600000000000000000000000000000000000000` est une vue ERC-20 du solde natif** : même argent,
  18 décimales en natif, 6 via l'ERC-20 (facteur 10¹²). Conséquence : **CCTP n'a besoin d'aucun
  wrapper ni contrat maison** — les fonds bridgés atterrissent dans le solde natif.
- gasPrice observé : 21 gwei. Un tip sponsorisé ≈ 186k gas ≈ **0,0039 USDC**, contre 0,02 USDC de
  frais sur un tip de 1 USDC. Point d'équilibre : **0,196 USDC** → d'où `minSponsoredTip` à 0,25.
- CCTP : Arc testnet = domaine **26**. Pas de domaine Arc mainnet publié.

## Pièges

- **Le paymaster doit être staké** auprès de l'EntryPoint : il lit son propre storage pendant la
  validation, et ERC-7562 fait rejeter les UserOps d'un paymaster non staké qui le fait.
  `deploy-paymaster.js` s'en charge.
- **`TipJar.treasury` doit pointer sur le paymaster**, sinon les frais ne financent jamais le
  sponsoring. C'est un appel du owner de TipJar, hors du script.
- Le `receive()` du paymaster doit tenir dans les **50k gas** de `TipJar._payout`, sinon les frais
  tombent dans `pendingWithdrawal`. Un test le verrouille — ne pas l'alourdir.
- Le paymaster **refuse `register`** volontairement : gratuit à appeler, donc sponsorisable à
  l'infini. Le claim d'un créateur passe par Gas Station (`registerPaymaster`) ou par son gas.
- Le sponsoring et les passkeys sont **inertes tant que `CIRCLE_WALLETS.clientKey` est vide**
  dans `website/js/config.js`. La clé est publique (restreinte par domaine), pas un secret.

## Déploiement

**`arctip.xyz` est servi par Vercel, pas par Railway**, depuis `website/`, et le
déploiement est **manuel** :

```
cd website && npx vercel --prod
```

Rien ne se publie sur un push vers `main`. C'est le piège principal de ce repo : le site
en ligne dérive du dépôt dès qu'on oublie la commande. Constaté le 28 août 2026 — la section
`$TIP` avait été retirée du dépôt et était **toujours en ligne**, avec fee rebate, cashback et
vote de curation, soit précisément ce qui devait disparaître avant le dossier Circle.

Le compte Vercel qui possède le projet (`team_p04BXb25…`) n'est pas le même que `moreno-g` :
`npx vercel --prod` doit tourner avec le bon compte connecté.

⚠️ **`website/vercel.json` n'est pas un reliquat.** Il porte la réécriture `/@:handle` →
`tip.html`, c'est-à-dire toute la surface de partage du produit. Sans lui, chaque lien créateur
renvoie un 404. `railway.json` et `server.js` à la racine sont un chemin distinct et inutilisé.

## À nettoyer

Trois captures traînent à la racine (`image-178499*.png`). Elles sont déjà couvertes par la règle
`image-*.png` du `.gitignore`, donc hors du dépôt — mais elles polluent le listing local.

# ArcTip

Lien de pourboire créateur réglé en **USDC sur Arc** : `arctip.app/@handle`. Le contrat `TipJar`
répartit le paiement, la part créateur part directement dans son wallet. `ArcTipPaymaster`
sponsorise le gas du fan et se rembourse sur les frais.

Live sur **Arc testnet** → [arctip.app](https://arctip.app). **Mainnet Arc : 16 septembre 2026.**

```
contracts/          Solidity (Hardhat) — TipJar, ArcTipPaymaster, interfaces/, mocks/, tests, scripts
website/            site + app statiques, aucune étape de build
website/api/tip.js  fonction Vercel : aperçus de partage par handle (sans dépendance)
tools/circle-bundle/  build ponctuel du bundle Circle vendoré (npm isolé ici)
tools/admin/        console d'administration locale — ne jamais déployer
server.js           petit serveur statique node:http pour servir website/ en local
```

## Commandes

```
npm start                            # sert website/ en local, port 8080
npm test                             # 51 tests (délègue à contracts/)
npm run admin                        # console d'admin → localhost:4174/tools/admin/
node tools/circle-bundle/build.js    # régénère website/vendor/circle-passkey.js
cd website && npx vercel --prod      # déploiement (voir les pièges plus bas)
```

## Règles propres à ce repo

- **`contracts/` est un sous-projet CommonJS avec des dépendances npm assumées** (Hardhat,
  OpenZeppelin, dotenv). La racine et `website/` restent en zéro dépendance / ESM.
- **`tools/circle-bundle/` est la seule autre exception npm**, et elle est délibérée : le SDK
  Circle Modular Wallets n'existe qu'en npm. Il est bundlé **une fois** vers
  `website/vendor/circle-passkey.js` et committé, comme `ethers.umd.min.js` avant lui. `website/`
  reste sans étape de build : le bundle n'est régénéré que si le SDK change.
- `website/api/tip.js` est une fonction serverless, mais **sans dépendance ni build** : Vercel
  exécute les fichiers de `/api` tels quels. Le zéro-build tient toujours.
- Argument produit central : sur Arc, l'USDC est l'actif de gas natif — le fan détient de l'USDC,
  tippe en USDC, paie le gas en USDC. Pas de « achetez d'abord notre token ». Ne pas introduire
  d'étape qui casse ça.
- **Pas de token ArcTip, et aucun prévu.** Un token de gouvernance/cashback sur un tip jar
  déssert le dossier Circle. Ne pas le réintroduire.
- Les polices sont **auto-hébergées** dans `website/fonts/` (woff2). Ne pas repasser sur un CDN.
- **Ne rien annoncer sur le site qui n'existe pas dans le code.** Un commit avait mis en page un
  faux bouton « Circle Social Login » et un contrat CCTP non fonctionnel ; c'est le risque le plus
  sérieux pour un dossier de grant. Les cartes de la section Circle portent un `status-tag`
  (`is-live` / `is-building`) — le tenir à jour.
- **Contraste AA obligatoire.** `--gold-600` échoue (4.0:1) sur les panneaux `--mist-100` ;
  utiliser `--gold-700` (5.3:1) là. Vérifier avant d'introduire une couleur de texte.

## État actuel (29 août 2026)

Tout est déployé et branché. Les trois appels d'admin sont passés, la boucle d'auto-financement
est fermée et vérifiée on-chain (un tip de 1 USDC a fait arriver 0,01 au paymaster).

| | |
|---|---|
| TipJar | `0x9BE91953aE20c079F8Ad932Ef6CF812f80aD217a` — frais **1 %**, treasury = paymaster |
| ArcTipPaymaster | `0x45E349F2977fB9eD9E4ae947ff8d98Db9002DcC8` — staké, dépôt 1 USDC, plancher 1 USDC |
| Owner des deux | `0x7De8aa2aDDa8D9A5565e75C5B89C7836c3Cb8e1f` (wallet froid, hors `.env`) |
| Deployeur | `0x5c32a3A5DbaEEB9f35D47586be1dbc7D05dA96be` (clé chaude, aucun droit d'admin) |
| Clé Circle | configurée, restreinte à `arctip.app` — vérifié : 200 depuis ce domaine, 401 ailleurs |

**Ce qui reste** : le test de bout en bout depuis un téléphone (créer un wallet Face ID, tipper
sans jamais détenir de gas → `sponsoredOps` passe à 1), puis `sweepToDeposit()` quand les frais
se sont accumulés. Et surtout l'**onboarding de créateurs** : le contrat en est à 2 tips, et la
traction est le seul critère du grant où il n'y a rien.

## Faits Arc vérifiés on-chain

À ne pas re-deviner — mesurés sur le testnet, pas lus dans une doc :

- **EntryPoints ERC-4337 v0.6, v0.7 et v0.8 : tous déployés.** v0.7 =
  `0x0000000071727De22E5E9d8BAf0edAc6f37da032`.
- **Aucune précompile P-256** (ni `0x100` ni `0x0b`) → vérifier une signature WebAuthn nous-mêmes
  on-chain est hors de prix. C'est la raison d'être du SDK Circle ici.
- **`0x3600000000000000000000000000000000000000` est une vue ERC-20 du solde natif** : même argent,
  18 décimales en natif, 6 via l'ERC-20 (facteur 10¹²). Conséquence : **CCTP n'a besoin d'aucun
  wrapper ni contrat maison** — les fonds bridgés atterrissent dans le solde natif.
- gasPrice observé : 21 gwei. Un tip sponsorisé ≈ 186k gas ≈ **0,0039 USDC**.
- **Les frais sont à 1 %**, calibrés pour couvrir ce gas et rien de plus : 0,01 USDC sur un tip de
  1 USDC, soit 2,6× le gas. Point d'équilibre **0,391 USDC**, d'où `minSponsoredTip` à **1 USDC** —
  le plancher tient jusqu'à un gas multiplié par 2,5. En dessous de 0,5 % on perd de l'argent dès
  que le gas bouge : ne pas baisser sans refaire le calcul.
- Les frais sont pris sur **tous** les tips, mais seuls ceux des wallets passkey sont sponsorisés :
  un tip depuis un wallet navigateur rapporte les frais sans rien coûter.
- CCTP : Arc testnet = domaine **26**. Pas de domaine Arc mainnet publié.

## Pièges

### Contrats

- ⚠️ **Le `TipJar` déployé n'a pas la même signature que `TipJar.sol` aujourd'hui.** Il expose
  `setFeeBps(uint256)` (`0x72c27b62`), la source a `setFeeBps(uint16)` (`0x023b1fc9`). Le contrat
  date du 25 juillet, le type a été resserré depuis. Un appel construit depuis la source échoue en
  « missing revert data » — ce qui ressemble à un problème de droits alors que c'est un sélecteur
  inexistant. **Vérifier les signatures contre le bytecode déployé, pas contre le source.**
- **Le paymaster doit être staké** auprès de l'EntryPoint : il lit son propre storage pendant la
  validation, et ERC-7562 fait rejeter les UserOps d'un paymaster non staké qui le fait.
- **`TipJar.treasury` doit pointer sur le paymaster**, sinon les frais ne financent jamais le
  sponsoring. Fait, mais à refaire après tout redéploiement du paymaster.
- Le `receive()` du paymaster doit tenir dans les **50k gas** de `TipJar._payout`, sinon les frais
  tombent dans `pendingWithdrawal`. Un test le verrouille — ne pas l'alourdir.
- Le paymaster **refuse `register`** volontairement : gratuit à appeler, donc sponsorisable à
  l'infini. Le claim d'un créateur passe par Gas Station (`registerPaymaster`) ou par son gas.

### Front

- ⚠️ **Le message d'un tip se compte en octets, pas en caractères.** `TipJar` plafonne à 280
  **octets** (`bytes(message).length`) ; un `maxlength` de navigateur compte des unités UTF-16.
  280 caractères accentués font 560 octets, 71 emoji en font 284 : le champ acceptait, le fan
  signait, payait le gas, et la transaction revertait. `tip.js` mesure avec `TextEncoder` — ne pas
  revenir à `maxlength`.
- ⚠️ **`hidden` ne cache rien si le composant fixe son `display`.** `.btn { display: inline-flex }`
  écrase la règle user-agent de `[hidden]`. Une règle globale `[hidden] { display: none !important }`
  le corrige — elle est en haut de `styles.css`, ne pas la retirer.
- **Tester la visibilité sur le `display` calculé, jamais sur `element.hidden`.** La propriété DOM
  était correcte pendant que l'écran montrait le contraire ; seule une capture l'a révélé.
- Les passkeys sont **liées au domaine** qui les crée. Une passkey faite sur `localhost` ou sur
  l'alias `*.vercel.app` ne fonctionne pas sur `arctip.app` : ce parcours n'est testable que sur le
  domaine de production.
- La clé Circle est **publique et restreinte par domaine** — elle vit dans `website/js/config.js`
  et gitleaks la laisse passer. Vérifié : 200 depuis `arctip.app`, 401 depuis ailleurs.

### Vérification

- **Le cache CDN et les nœuds edge produisent de faux négatifs.** Deux contrôles ont conclu à tort
  qu'une config était absente (en-têtes de sécurité, aperçus par handle) alors qu'elle était bonne.
  Contourner le cache (`?cb=$(date +%s%N)`) sur tout contrôle post-déploiement.

## Déploiement

Le site est servi par **Vercel**, depuis `website/`, et le déploiement est **manuel**. Rien ne se
publie sur un push vers `main` : le site en ligne dérive du dépôt dès qu'on oublie la commande.

| | |
|---|---|
| Domaine | `arctip.app` — registrar **Namecheap**, DNS **Namecheap** |
| Hébergement | Vercel, team `moreno-g`, projet `arctip` |
| URL de secours | `arctip-psi.vercel.app` (l'alias `arctip-moreno-g` est protégé par login) |

Le DNS reste **délibérément chez Namecheap** plutôt que délégué à Vercel : deux enregistrements y
pointent vers l'hébergeur (`A @ → 76.76.21.21`, `CNAME www → cname.vercel-dns.com`). C'est la leçon
d'`arctip.xyz` — domaine, DNS et hébergement sur un même compte, c'est un point unique de
défaillance. Ici, un compte Vercel perdu ne coûterait qu'un redéploiement et deux lignes de DNS.

⚠️ **Déployer depuis une copie sans `.git`.** Sur le plan Hobby, Vercel bloque
(`readyState: BLOCKED`, message trompeur « Not authorized ») quand il n'arrive pas à rattacher
l'auteur des commits au propriétaire du compte. Copier `website/` hors du dépôt, y remettre
`.vercel/project.json`, et déployer de là.

⚠️ **`website/vercel.json` n'est pas un reliquat.** Il porte la réécriture `/@:handle` →
`/api/tip`, c'est-à-dire toute la surface de partage du produit, plus les en-têtes de sécurité
(`X-Frame-Options`, `frame-ancestors`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`). Sans
lui, chaque lien créateur renvoie un 404 et la page de paiement redevient iframable.

⚠️ **`arctip.xyz` est perdu, et affiche encore la section `$TIP`.** Acheté le 25 juillet 2026 via
un compte Vercel (`team_p04BXb25…`) dont l'identifiant n'a pas été retrouvé — probablement une
connexion GitHub sous l'ancien pseudo `mrlazeeem`. Le domaine, son DNS et le projet d'origine sont
tous dessus, donc rien n'y est corrigeable jusqu'à l'expiration, le 25 juillet 2027. **Ne plus
citer `arctip.xyz` nulle part.** `stabledesk.xyz` est sur le même compte, avec son DNS : le
récupérer dépasse ArcTip.

## Intégration continue

`.github/workflows/ci.yml`, sur push vers `main` et sur chaque PR :

- **Contract tests** — `npm ci` (et non `npm install` : un lockfile qui a dérivé doit échouer
  bruyamment) puis les 51 tests.
- **Website syntax** — `node --check` sur chaque script du front. `website/` n'a ni build ni
  dépendances, donc une erreur de syntaxe y reste invisible jusqu'à l'ouverture de la page.

La CI ne déploie rien : c'est manuel, et volontairement.

## À nettoyer

Trois captures traînent à la racine (`image-178499*.png`). Elles sont couvertes par la règle
`image-*.png` du `.gitignore`, donc hors du dépôt — mais elles polluent le listing local.

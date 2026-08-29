// Local admin console for the owner-only calls.
//
// Deliberately outside website/ so it never ships: these buttons redirect
// revenue and change fees, and they have no business sitting on a public
// domain even behind a wallet check.
//
// It signs nothing on its own — every action goes through the connected
// wallet, so the owner key stays where it belongs and never touches .env.
(() => {
  const ARC = {
    chainIdHex: "0x4CEF52",
    chainId: 5042002n,
    name: "Arc Testnet",
    explorer: "https://testnet.arcscan.app",
  };
  const TIPJAR = "0x9BE91953aE20c079F8Ad932Ef6CF812f80aD217a";
  const PAYMASTER = "0x45E349F2977fB9eD9E4ae947ff8d98Db9002DcC8";

  const TIPJAR_ABI = [
    "function feeBps() view returns (uint256)",
    "function treasury() view returns (address)",
    "function owner() view returns (address)",
    "function setTreasury(address)",
    // uint256, not the uint16 in TipJar.sol today. The live contract was
    // deployed on 25 July, before the type was narrowed, and the selector
    // differs — 0x72c27b62 against 0x023b1fc9. Matching the source instead of
    // the deployment is what makes this call revert with "missing revert data".
    "function setFeeBps(uint256)",
  ];
  const PM_ABI = [
    "function owner() view returns (address)",
    "function pendingOwner() view returns (address)",
    "function deposit() view returns (uint256)",
    "function feesReceived() view returns (uint256)",
    "function sponsoredOps() view returns (uint256)",
    "function acceptOwnership()",
  ];

  const $ = (id) => document.getElementById(id);
  let signer = null;
  let account = null;

  function msg(el, text, kind) {
    el.replaceChildren();
    if (!text) return;
    const d = document.createElement("div");
    d.className = `msg ${kind}`;
    d.textContent = text;
    el.appendChild(d);
  }

  function txLink(el, hash, label) {
    el.replaceChildren();
    const d = document.createElement("div");
    d.className = "msg ok";
    d.append(document.createTextNode(`${label} — `));
    const a = document.createElement("a");
    a.href = `${ARC.explorer}/tx/${hash}`;
    a.target = "_blank";
    a.rel = "noopener";
    a.textContent = "voir la transaction";
    d.appendChild(a);
    el.appendChild(d);
  }

  function tag(el, state, text) {
    el.className = `tag ${state}`;
    el.textContent = text;
  }

  const read = () =>
    new ethers.JsonRpcProvider("https://5042002.rpc.thirdweb.com", {
      chainId: 5042002,
      name: "arc-testnet",
    });

  /// Reads the chain and decides which steps are still outstanding. Everything
  /// on screen comes from this — no local state pretending to know better.
  async function refresh() {
    const p = read();
    const tj = new ethers.Contract(TIPJAR, TIPJAR_ABI, p);
    const pm = new ethers.Contract(PAYMASTER, PM_ABI, p);

    const [fee, treasury, tjOwner, pmOwner, pending, dep, fees, ops] = await Promise.all([
      tj.feeBps(), tj.treasury(), tj.owner(),
      pm.owner(), pm.pendingOwner(), pm.deposit(), pm.feesReceived(), pm.sponsoredOps(),
    ]);

    $("sFee").textContent = `${fee} bps (${Number(fee) / 100}%)`;
    $("sTreasury").textContent = treasury;
    $("sPmOwner").textContent = pmOwner;
    $("sDeposit").textContent = `${ethers.formatEther(dep)} USDC`;
    $("sFees").textContent = `${ethers.formatEther(fees)} USDC`;
    $("sOps").textContent = ops.toString();
    $("expectedOwner").textContent = tjOwner;

    const isOwner = account && account.toLowerCase() === tjOwner.toLowerCase();

    // 01 — ownership accepted?
    const accepted = pmOwner.toLowerCase() === tjOwner.toLowerCase();
    tag($("t1"), accepted ? "ok" : "todo", accepted ? "fait" : "à faire");
    $("b1").disabled = accepted || !isOwner || pending.toLowerCase() !== (account || "").toLowerCase();

    // 02 — fees routed to the paymaster?
    const routed = treasury.toLowerCase() === PAYMASTER.toLowerCase();
    tag($("t2"), routed ? "ok" : "todo", routed ? "fait" : "à faire");
    $("b2").disabled = routed || !isOwner;

    // 03 — fee down to 1%?
    const cut = fee === 100n;
    tag($("t3"), cut ? "ok" : "todo", cut ? "fait" : "à faire");
    $("b3").disabled = cut || !isOwner;

    if (account && !isOwner) {
      msg($("connMsg"), `Ce wallet n'est pas l'owner. Connecte ${tjOwner}.`, "err");
    }
  }

  async function connect() {
    const eth = window.ethereum;
    if (!eth) {
      msg($("connMsg"), "Aucun wallet détecté. Installe MetaMask ou Rabby.", "err");
      return;
    }
    try {
      await eth.request({ method: "eth_requestAccounts" });
      try {
        await eth.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: ARC.chainIdHex }],
        });
      } catch (e) {
        if (e.code !== 4902) throw e;
        await eth.request({
          method: "wallet_addEthereumChain",
          params: [{
            chainId: ARC.chainIdHex, chainName: ARC.name,
            nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
            rpcUrls: ["https://5042002.rpc.thirdweb.com"],
            blockExplorerUrls: [ARC.explorer],
          }],
        });
      }

      const provider = new ethers.BrowserProvider(eth);
      const net = await provider.getNetwork();
      if (net.chainId !== ARC.chainId) {
        msg($("connMsg"), `Mauvais réseau : ${net.chainId}. Bascule sur ${ARC.name}.`, "err");
        return;
      }
      signer = await provider.getSigner();
      account = await signer.getAddress();
      $("acct").textContent = account;
      $("net").textContent = `${ARC.name} (${net.chainId})`;
      msg($("connMsg"), "", "");
      await refresh();
    } catch (err) {
      msg($("connMsg"), err.shortMessage || err.message || "Connexion impossible.", "err");
    }
  }

  /// Every action goes through the wallet, reports the tx, then re-reads the
  /// chain rather than assuming it worked.
  async function run(btn, out, label, fn) {
    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = "Confirme dans ton wallet…";
    msg(out, "", "");
    try {
      const tx = await fn();
      btn.textContent = "En attente de confirmation…";
      const receipt = await tx.wait();
      txLink(out, receipt.hash, `${label} — confirmé`);
      await refresh();
    } catch (err) {
      msg(out, err.shortMessage || err.message || "La transaction a échoué.", "err");
      btn.disabled = false;
    } finally {
      btn.textContent = original;
    }
  }

  $("connect").addEventListener("click", connect);
  $("refresh").addEventListener("click", () => refresh().catch((e) => msg($("connMsg"), e.message, "err")));

  $("b1").addEventListener("click", () =>
    run($("b1"), $("m1"), "Propriété acceptée", () =>
      new ethers.Contract(PAYMASTER, PM_ABI, signer).acceptOwnership()));

  $("b2").addEventListener("click", () =>
    run($("b2"), $("m2"), "Frais routés vers le paymaster", () =>
      new ethers.Contract(TIPJAR, TIPJAR_ABI, signer).setTreasury(PAYMASTER)));

  $("b3").addEventListener("click", () =>
    run($("b3"), $("m3"), "Frais passés à 1%", () =>
      new ethers.Contract(TIPJAR, TIPJAR_ABI, signer).setFeeBps(100)));

  if (window.ethereum) {
    window.ethereum.on?.("accountsChanged", () => window.location.reload());
    window.ethereum.on?.("chainChanged", () => window.location.reload());
  }

  // Show the chain state before any wallet is connected.
  refresh().catch(() => {});
})();

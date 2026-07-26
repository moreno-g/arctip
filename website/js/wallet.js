// Thin wrapper around window.ethereum + ethers.js for connecting a wallet,
// keeping it on Arc, and getting a TipJar contract instance.

async function connectWallet() {
  if (!window.ethereum) {
    throw new Error("No wallet found. Install MetaMask or another injected wallet to continue.");
  }
  await window.ethereum.request({ method: "eth_requestAccounts" });
  await ensureArcNetwork();

  const provider = new ethers.BrowserProvider(window.ethereum);
  await assertArcNetwork(provider);

  const signer = await provider.getSigner();
  return { provider, signer, address: await signer.getAddress() };
}

async function ensureArcNetwork() {
  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: ARC_TESTNET.chainIdHex }],
    });
  } catch (switchError) {
    // 4902 = chain not added to the wallet yet
    if (switchError.code === 4902) {
      await window.ethereum.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: ARC_TESTNET.chainIdHex,
            chainName: ARC_TESTNET.chainName,
            nativeCurrency: ARC_TESTNET.nativeCurrency,
            rpcUrls: ARC_TESTNET.rpcUrls,
            blockExplorerUrls: ARC_TESTNET.blockExplorerUrls,
          },
        ],
      });
    } else {
      throw switchError;
    }
  }
}

/// Requesting a network switch is not the same as getting one: a wallet can
/// refuse it, fail quietly, or the user can switch back afterwards. Every write
/// re-checks, because sending value to this contract address on another chain
/// means sending it to an address with no code — the funds are simply gone.
async function assertArcNetwork(provider) {
  const net = await provider.getNetwork();
  if (net.chainId !== BigInt(ARC_TESTNET.chainId)) {
    throw new Error(
      `Wrong network: your wallet is on chain ${net.chainId}, not ${ARC_TESTNET.chainName} (${ARC_TESTNET.chainId}). Switch networks and try again.`
    );
  }
}

/// Re-checks the chain, then hands back a contract bound to a fresh signer.
/// Call this immediately before any transaction rather than reusing a signer
/// captured at connect time.
async function getVerifiedWriteContract() {
  if (!window.ethereum) {
    throw new Error("No wallet found. Install MetaMask or another injected wallet to continue.");
  }
  const provider = new ethers.BrowserProvider(window.ethereum);
  await assertArcNetwork(provider);
  const signer = await provider.getSigner();
  return { contract: new ethers.Contract(TIPJAR_ADDRESS, TIPJAR_ABI, signer), signer };
}

/// A wallet can change account or network at any moment, which silently
/// invalidates anything derived from it. Simplest correct response is to reload.
function watchWalletChanges() {
  if (!window.ethereum || !window.ethereum.on) return;
  const reload = () => window.location.reload();
  window.ethereum.on("chainChanged", reload);
  window.ethereum.on("accountsChanged", reload);
}

let _cachedProvider = null;

function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

// The public Arc RPC rate-limits quickly, so fall back to the next URL in
// ARC_TESTNET.rpcUrls whenever one fails. The timeout matters as much as the
// error handling: an endpoint that hangs instead of failing would otherwise
// stall the page forever without ever triggering the fallback.
async function getReadOnlyProvider() {
  if (_cachedProvider) {
    try {
      await withTimeout(_cachedProvider.getBlockNumber(), 4000, "RPC");
      return _cachedProvider;
    } catch {
      _cachedProvider = null; // it went bad; fall through and pick another
    }
  }

  for (const url of ARC_TESTNET.rpcUrls) {
    const provider = new ethers.JsonRpcProvider(url, {
      chainId: ARC_TESTNET.chainId,
      name: "arc-testnet",
    });
    try {
      await withTimeout(provider.getBlockNumber(), 4000, "RPC");
      _cachedProvider = provider;
      return provider;
    } catch (err) {
      // try the next RPC URL
    }
  }
  throw new Error("Couldn't reach Arc Testnet — all RPC endpoints are unavailable right now.");
}

async function getReadOnlyContract() {
  const provider = await getReadOnlyProvider();
  return new ethers.Contract(TIPJAR_ADDRESS, TIPJAR_ABI, provider);
}

function shortAddress(address) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

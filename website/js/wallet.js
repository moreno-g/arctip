// EIP-6963 Provider Discovery Store & Error Helper
const eip6963Providers = new Map();

if (typeof window !== "undefined") {
  window.addEventListener("eip6963:announceProvider", (event) => {
    const { info, provider } = event.detail;
    eip6963Providers.set(info.rdns, { info, provider });
  });
  window.dispatchEvent(new Event("eip6963:requestProvider"));
}

function getActiveInjectedProvider() {
  if (eip6963Providers.size > 0) {
    const first = eip6963Providers.values().next().value;
    return first.provider;
  }
  return window.ethereum || null;
}

function mapWeb3Error(err) {
  if (!err) return "An unexpected error occurred.";
  const code = err.code || (err.error && err.error.code);
  const msg = err.message || "";
  
  if (code === 4001 || msg.includes("user rejected") || err.code === "ACTION_REJECTED") {
    return "Transaction cancelled in wallet.";
  }
  if (code === -32603 || msg.includes("insufficient funds")) {
    return "Insufficient USDC balance or gas in wallet for this transaction.";
  }
  if (err.shortMessage) return err.shortMessage;
  return msg || "Transaction failed. Please try again.";
}

async function connectWallet() {
  const ethereum = getActiveInjectedProvider();
  if (!ethereum) {
    throw new Error("No wallet found. Install MetaMask, Rabby, or use Circle Social Login to continue.");
  }
  await ethereum.request({ method: "eth_requestAccounts" });
  await ensureArcNetwork(ethereum);

  const provider = new ethers.BrowserProvider(ethereum);
  await assertArcNetwork(provider);

  const signer = await provider.getSigner();
  return { provider, signer, address: await signer.getAddress() };
}

async function ensureArcNetwork(ethereum = getActiveInjectedProvider()) {
  if (!ethereum) return;
  try {
    await ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: ARC_TESTNET.chainIdHex }],
    });
  } catch (switchError) {
    if (switchError.code === 4902) {
      await ethereum.request({
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

async function assertArcNetwork(provider) {
  const net = await provider.getNetwork();
  if (net.chainId !== BigInt(ARC_TESTNET.chainId)) {
    throw new Error(
      `Wrong network: your wallet is on chain ${net.chainId}, not ${ARC_TESTNET.chainName} (${ARC_TESTNET.chainId}). Switch networks and try again.`
    );
  }
}

async function getVerifiedWriteContract() {
  const ethereum = getActiveInjectedProvider();
  if (!ethereum) {
    throw new Error("No wallet found. Install MetaMask or another injected wallet to continue.");
  }
  const provider = new ethers.BrowserProvider(ethereum);
  await assertArcNetwork(provider);
  const signer = await provider.getSigner();
  return { contract: new ethers.Contract(TIPJAR_ADDRESS, TIPJAR_ABI, signer), signer };
}

function watchWalletChanges() {
  const ethereum = getActiveInjectedProvider();
  if (!ethereum || !ethereum.on) return;
  const reload = () => window.location.reload();
  ethereum.on("chainChanged", reload);
  ethereum.on("accountsChanged", reload);
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

async function getReadOnlyProvider() {
  if (_cachedProvider) {
    try {
      await withTimeout(_cachedProvider.getBlockNumber(), 4000, "RPC");
      return _cachedProvider;
    } catch {
      _cachedProvider = null;
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
      // try next RPC
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


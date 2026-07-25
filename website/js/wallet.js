// Thin wrapper around window.ethereum + ethers.js for connecting a wallet,
// making sure it's on Arc testnet, and getting a TipJar contract instance.

async function connectWallet() {
  if (!window.ethereum) {
    throw new Error("No wallet found. Install MetaMask or another injected wallet to continue.");
  }
  await window.ethereum.request({ method: "eth_requestAccounts" });
  await ensureArcNetwork();

  const provider = new ethers.BrowserProvider(window.ethereum);
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

let _cachedProvider = null;

// The public Arc RPC rate-limits quickly, so fall back to the next URL in
// ARC_TESTNET.rpcUrls whenever a call fails, instead of breaking the page.
async function getReadOnlyProvider() {
  if (_cachedProvider) return _cachedProvider;

  for (const url of ARC_TESTNET.rpcUrls) {
    const provider = new ethers.JsonRpcProvider(url, {
      chainId: ARC_TESTNET.chainId,
      name: "arc-testnet",
    });
    try {
      await provider.getBlockNumber();
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

function getWriteContract(signer) {
  return new ethers.Contract(TIPJAR_ADDRESS, TIPJAR_ABI, signer);
}

function shortAddress(address) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

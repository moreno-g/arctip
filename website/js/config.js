// Arc testnet network + TipJar deployment — update TIPJAR_ADDRESS when redeploying.
const ARC_TESTNET = {
  chainIdHex: "0x4CEF52", // 5042002
  chainId: 5042002,
  chainName: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  // thirdweb's gateway first: the official Arc RPC rate-limits quickly under
  // modest traffic, and this order is also what wallets use for gas estimation
  // when they first add the network — not just our own fallback logic.
  rpcUrls: ["https://5042002.rpc.thirdweb.com", "https://rpc.testnet.arc.network"],
  blockExplorerUrls: ["https://testnet.arcscan.app"],
};

const TIPJAR_ADDRESS = "0x9BE91953aE20c079F8Ad932Ef6CF812f80aD217a";

// --- Sponsored gas & passkey wallets ---

// ArcTipPaymaster. Sponsors the gas for tips so a fan never needs a gas balance
// to support someone; funded on-chain by the tip fees themselves. Empty until
// deployed, in which case the fan simply pays their own gas — on Arc, where
// USDC is the gas asset, anyone holding USDC already can.
const PAYMASTER_ADDRESS = "";

// Circle Modular Wallets. The client key is a public, domain-restricted key
// meant to ship in front-end code — it is not a secret, and there is no server
// here to hide one behind. Passkey sign-in stays hidden until this is filled in.
const CIRCLE_WALLETS = {
  clientKey: "TEST_CLIENT_KEY:746eab65a771af2e9dfca0bbd8d62cdf:95a33143424cd3d25df9bb1b9718f7f9",
  clientUrl: "https://modular-sdk.circle.com/v1/rpc/w3s/buidl",
  chainPath: "arcTestnet",
  tipJarAddress: TIPJAR_ADDRESS,
  // An address routes gas through our own paymaster; `true` would fall back to
  // Circle Gas Station, billed to a card rather than funded by the fees.
  paymaster: PAYMASTER_ADDRESS,
  // Claiming a handle is a separate question. ArcTipPaymaster refuses to
  // sponsor `register` on purpose — it costs nothing to call, so sponsoring it
  // would let anyone mint handles until the deposit ran dry. A creator's
  // one-off claim goes through Circle Gas Station instead when this is on.
  registerPaymaster: false,
};

const TIPJAR_ABI = [
  "function register(string handle)",
  "function transferHandle(string handle, address newOwner)",
  "function tip(string handle, string message, uint256 maxFeeBps) payable",
  "function withdraw()",
  "function handleOwner(string handle) view returns (address)",
  "function isHandleTaken(string handle) view returns (bool)",
  "function ownerHandle(address owner) view returns (string)",
  "function pendingWithdrawal(address payee) view returns (uint256)",
  "function feeBps() view returns (uint256)",
  "function handleCount() view returns (uint256)",
  "function tipCount() view returns (uint256)",
  "function totalTipped() view returns (uint256)",
  "function MAX_MESSAGE_LENGTH() view returns (uint256)",
  "event HandleRegistered(string handle, address indexed owner)",
  "event HandleTransferred(string handle, address indexed from, address indexed to)",
  "event Tipped(string handle, address indexed recipient, address indexed sender, uint256 amount, uint256 fee, string message)",
  "event PayoutDeferred(address indexed payee, uint256 amount)",
];

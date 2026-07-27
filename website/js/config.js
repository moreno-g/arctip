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

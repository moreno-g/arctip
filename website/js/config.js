// Arc testnet network + TipJar deployment — update ADDRESS when redeploying.
const ARC_TESTNET = {
  chainIdHex: "0x4CEF52", // 5042002
  chainId: 5042002,
  chainName: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  // The public Arc RPC rate-limits quickly under modest traffic — a second
  // gateway is listed as a fallback so the site keeps working when it does.
  rpcUrls: ["https://rpc.testnet.arc.network", "https://5042002.rpc.thirdweb.com"],
  blockExplorerUrls: ["https://testnet.arcscan.app"],
};

const TIPJAR_ADDRESS = "0xb2f2DB422756b139E0627744176b137E23FdA30a";

const TIPJAR_ABI = [
  "function register(string handle)",
  "function tip(string handle, string message) payable",
  "function handleOwner(string handle) view returns (address)",
  "function isHandleTaken(string handle) view returns (bool)",
  "function ownerHandle(address owner) view returns (string)",
  "function feeBps() view returns (uint256)",
  "event HandleRegistered(string handle, address indexed owner)",
  "event Tipped(string handle, address indexed recipient, address indexed sender, uint256 amount, uint256 fee, string message)",
];

// Facade over Circle's Modular Wallets SDK, bundled into a single global for
// website/vendor/. The site loads plain <script> tags and has no build step, so
// everything the passkey flow needs is flattened into one file here and the
// surface exposed to the page is deliberately small.
//
// Everything below is the fan's side of the product: create a wallet from a
// passkey, then send a tip whose gas somebody else pays for.

import { createPublicClient, encodeFunctionData, parseEther } from "viem";
import { arcTestnet } from "viem/chains";
import { createBundlerClient, toWebAuthnAccount } from "viem/account-abstraction";
import {
  WebAuthnMode,
  toCircleSmartAccount,
  toModularTransport,
  toPasskeyTransport,
  toWebAuthnCredential,
} from "@circle-fin/modular-wallets-core";

const CREDENTIAL_KEY = "arctip_passkey_credential";

// The tip call, written out rather than imported: the bundle must not depend on
// the site's ethers ABI, and this is the only contract call the fan ever makes.
const TIP_ABI = [
  {
    type: "function",
    name: "tip",
    stateMutability: "payable",
    inputs: [
      { name: "handle", type: "string" },
      { name: "message", type: "string" },
      { name: "maxFeeBps", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "register",
    stateMutability: "nonpayable",
    inputs: [{ name: "handle", type: "string" }],
    outputs: [],
  },
];

let config = null;
let session = null; // { credential, account, bundlerClient }

/// Passkeys need a secure context and a platform authenticator. Checking up
/// front means the page can offer the wallet path only where it will work,
/// instead of failing at the moment the fan commits to tipping.
async function isSupported() {
  if (typeof window === "undefined") return false;
  if (!window.isSecureContext) return false;
  if (!window.PublicKeyCredential) return false;
  try {
    return await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

function configure(next) {
  config = next;
}

/// True when the site has been given a Circle client key. Without one the
/// passkey path cannot work at all, and the page should keep quiet about it
/// rather than offering a button that throws.
function isConfigured() {
  return Boolean(config && config.clientKey && config.clientUrl);
}

function requireConfig() {
  if (!isConfigured()) {
    throw new Error(
      "Passkey wallets aren't configured on this deployment — connect a browser wallet instead."
    );
  }
  return config;
}

function transports() {
  const { clientKey, clientUrl, chainPath } = requireConfig();
  return {
    passkey: toPasskeyTransport(clientUrl, clientKey),
    modular: toModularTransport(`${clientUrl}/${chainPath}`, clientKey),
  };
}

async function buildSession(credential) {
  const { modular } = transports();

  const client = createPublicClient({ chain: arcTestnet, transport: modular });
  const account = await toCircleSmartAccount({
    client,
    owner: toWebAuthnAccount({ credential }),
  });
  const bundlerClient = createBundlerClient({ chain: arcTestnet, transport: modular });

  session = { credential, account, bundlerClient };
  return { address: account.address };
}

/// Create a wallet. The passkey is generated and held by the device — we never
/// see or store key material, only the public credential needed to rebuild the
/// account on the next visit.
async function register(username) {
  const { passkey } = transports();
  const credential = await toWebAuthnCredential({
    transport: passkey,
    mode: WebAuthnMode.Register,
    username,
  });
  localStorage.setItem(CREDENTIAL_KEY, JSON.stringify(credential));
  return buildSession(credential);
}

/// Sign in with a passkey this device already holds.
async function login() {
  const { passkey } = transports();
  const credential = await toWebAuthnCredential({
    transport: passkey,
    mode: WebAuthnMode.Login,
  });
  localStorage.setItem(CREDENTIAL_KEY, JSON.stringify(credential));
  return buildSession(credential);
}

/// Rebuild the account from the credential kept on this device, without
/// prompting. Returns null when there is nothing stored, so the page can show
/// the sign-in path instead of an error.
async function resume() {
  if (session) return { address: session.account.address };
  const stored = localStorage.getItem(CREDENTIAL_KEY);
  if (!stored) return null;
  try {
    return await buildSession(JSON.parse(stored));
  } catch {
    // A credential that no longer rebuilds is worse than none: clear it so the
    // fan is offered a clean sign-in rather than the same failure every visit.
    localStorage.removeItem(CREDENTIAL_KEY);
    return null;
  }
}

function forget() {
  localStorage.removeItem(CREDENTIAL_KEY);
  session = null;
}

function currentAddress() {
  return session ? session.account.address : null;
}

/// Read the balance of the smart account, in native USDC. The fan needs this to
/// cover the tip itself — sponsorship covers the gas, never the amount.
async function balance() {
  if (!session) return 0n;
  const { modular } = transports();
  const client = createPublicClient({ chain: arcTestnet, transport: modular });
  return client.getBalance({ address: session.account.address });
}

/// Send a tip as a sponsored user operation.
///
/// `paymaster` decides who pays the gas:
///   - an address  -> ArcTipPaymaster, funded on-chain by the tip fees
///   - true        -> Circle Gas Station, billed to the developer's account
///   - false       -> the fan pays their own gas, which on Arc they can
async function sendTip({ handle, message, amount, maxFeeBps }) {
  if (!session) throw new Error("No passkey wallet in this session.");
  const { tipJarAddress, paymaster } = requireConfig();

  const value = parseEther(String(amount));
  const data = encodeFunctionData({
    abi: TIP_ABI,
    functionName: "tip",
    args: [handle, message ?? "", BigInt(maxFeeBps)],
  });

  const request = {
    account: session.account,
    calls: [{ to: tipJarAddress, value, data }],
  };

  if (paymaster === true) {
    request.paymaster = true;
  } else if (typeof paymaster === "string" && paymaster.startsWith("0x")) {
    // ArcTipPaymaster validates on the contents of the call, not a signature
    // from us, so there is no paymasterData to attach.
    request.paymaster = paymaster;
    request.paymasterData = "0x";
  }

  const hash = await session.bundlerClient.sendUserOperation(request);
  const { receipt } = await session.bundlerClient.waitForUserOperationReceipt({ hash });
  return { userOpHash: hash, txHash: receipt.transactionHash };
}

/// Claim a handle from a passkey wallet.
///
/// This deliberately does NOT go through ArcTipPaymaster: that paymaster only
/// sponsors `tip`, because `register` costs nothing to call and sponsoring it
/// would let anyone mint handles on our budget until the deposit was empty.
/// A creator's one-off registration is sponsored through Circle Gas Station
/// when `registerPaymaster` is on, and otherwise paid by the creator — a few
/// tenths of a cent, once.
async function claimHandle(handle) {
  if (!session) throw new Error("No passkey wallet in this session.");
  const { tipJarAddress, registerPaymaster } = requireConfig();

  const data = encodeFunctionData({
    abi: TIP_ABI,
    functionName: "register",
    args: [handle],
  });

  const request = {
    account: session.account,
    calls: [{ to: tipJarAddress, value: 0n, data }],
  };
  if (registerPaymaster === true) request.paymaster = true;

  const hash = await session.bundlerClient.sendUserOperation(request);
  const { receipt } = await session.bundlerClient.waitForUserOperationReceipt({ hash });
  return { userOpHash: hash, txHash: receipt.transactionHash };
}

export default {
  configure,
  claimHandle,
  isConfigured,
  isSupported,
  register,
  login,
  resume,
  forget,
  currentAddress,
  balance,
  sendTip,
};

// Passkey wallets, on top of Circle Modular Wallets.
//
// The fan side of ArcTip has one hard problem: a tip link is shared with people
// who do not have a wallet and will not install one to send five dollars. A
// passkey turns that into the gesture they already use to unlock their phone.
//
// The vendored SDK bundle is ~800 KB, so it is fetched only when a fan actually
// chooses this path — never on page load, and never for someone arriving with a
// browser wallet already installed.
const ArcTipPasskey = (() => {
  const BUNDLE_SRC = "vendor/circle-passkey.js";
  const USERNAME_KEY = "arctip_passkey_username";

  let bundlePromise = null;
  let sdk = null;

  function loadBundle() {
    if (bundlePromise) return bundlePromise;
    bundlePromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = BUNDLE_SRC;
      script.async = true;
      script.onload = () => {
        if (!window.ArcTipPasskey_SDK) {
          reject(new Error("Passkey wallet failed to load."));
          return;
        }
        sdk = window.ArcTipPasskey_SDK;
        sdk.configure(CIRCLE_WALLETS);
        resolve(sdk);
      };
      script.onerror = () => {
        // Let a later attempt retry rather than caching the failure forever.
        bundlePromise = null;
        reject(new Error("Couldn't load the passkey wallet. Check your connection and try again."));
      };
      document.head.appendChild(script);
    });
    return bundlePromise;
  }

  /// Whether to offer this path at all. Deliberately cheap and synchronous
  /// where it can be: it gates whether a button is rendered, so it must not
  /// pull 800 KB just to decide the answer is no.
  function configured() {
    return Boolean(
      typeof CIRCLE_WALLETS !== "undefined" && CIRCLE_WALLETS.clientKey && window.PublicKeyCredential
    );
  }

  /// The full check, including whether this device actually has a platform
  /// authenticator. A desktop without Touch ID reports false here, and the page
  /// falls back to the browser-wallet path.
  async function available() {
    if (!configured()) return false;
    if (!window.isSecureContext) return false;
    try {
      return await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    } catch {
      return false;
    }
  }

  /// True when this device has already made a wallet here, which decides
  /// whether the fan is offered "create" or "sign in".
  function hasCredential() {
    return Boolean(localStorage.getItem("arctip_passkey_credential"));
  }

  /// Restore a wallet from the credential already on this device. Silent: no
  /// biometric prompt, so it is safe to call on page load.
  async function resume() {
    if (!configured() || !hasCredential()) return null;
    const api = await loadBundle();
    return api.resume();
  }

  async function createWallet(username) {
    const api = await loadBundle();
    const name = (username || "").trim() || "arctip supporter";
    localStorage.setItem(USERNAME_KEY, name);
    return api.register(name);
  }

  async function signIn() {
    const api = await loadBundle();
    return api.login();
  }

  function address() {
    return sdk ? sdk.currentAddress() : null;
  }

  async function balance() {
    if (!sdk) return 0n;
    return sdk.balance();
  }

  function forget() {
    if (sdk) sdk.forget();
    localStorage.removeItem(USERNAME_KEY);
  }

  /// Send the tip as a sponsored user operation.
  ///
  /// Sponsorship covers the gas, never the amount: the fan still has to hold
  /// the USDC they are sending. Saying otherwise would be a lie the receipt
  /// would immediately expose.
  async function sendTip(args) {
    if (!sdk) throw new Error("No passkey wallet in this session.");
    return sdk.sendTip(args);
  }

  /// Claim a handle from a passkey wallet, for a creator arriving without one.
  async function claimHandle(handle) {
    if (!sdk) throw new Error("No passkey wallet in this session.");
    return sdk.claimHandle(handle);
  }

  return {
    configured,
    available,
    hasCredential,
    resume,
    createWallet,
    signIn,
    address,
    balance,
    forget,
    sendTip,
    claimHandle,
  };
})();

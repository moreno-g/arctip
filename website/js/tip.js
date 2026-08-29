(() => {
  // Two shapes reach this page: the shareable /@handle URL, and the older
  // ?handle= form. A Vercel rewrite serves this file for /@handle without
  // changing the address bar, so there is no query string to read in that case —
  // the pathname is the only place the handle appears.
  function readHandle() {
    const fromPath = window.location.pathname.match(/^\/@([^/]+)\/?$/);
    if (fromPath) return decodeURIComponent(fromPath[1]);
    return new URLSearchParams(window.location.search).get("handle") || "";
  }

  const handle = readHandle().trim().toLowerCase();

  const handleTitle = document.getElementById("handleTitle");
  const handleLead = document.getElementById("handleLead");
  const notFoundMsg = document.getElementById("notFoundMsg");
  const tipCard = document.getElementById("tipCard");
  const receiptCard = document.getElementById("receiptCard");
  const amountBtns = [...document.querySelectorAll(".amount-btn")];
  const customField = document.getElementById("customAmountField");
  const customInput = document.getElementById("customAmountInput");
  const messageInput = document.getElementById("messageInput");
  const messageCount = document.getElementById("messageCount");
  const sendBtn = document.getElementById("sendBtn");
  const tipMsg = document.getElementById("tipMsg");
  const walletChip = document.getElementById("walletChip");
  const receiptHandle = document.getElementById("receiptHandle");
  const receiptAmount = document.getElementById("receiptAmount");
  const receiptExplorerLink = document.getElementById("receiptExplorerLink");
  const recipientAddress = document.getElementById("recipientAddress");
  const recipientExplorer = document.getElementById("recipientExplorer");
  const sendAnotherBtn = document.getElementById("sendAnotherBtn");

  const payWith = document.getElementById("payWith");
  const passkeyBtn = document.getElementById("passkeyBtn");
  const passkeySignInBtn = document.getElementById("passkeySignInBtn");
  const connectWalletBtn = document.getElementById("connectWalletBtn");
  const passkeyHint = document.getElementById("passkeyHint");
  const walletSummary = document.getElementById("walletSummary");
  const payerAddress = document.getElementById("payerAddress");
  const payerBalance = document.getElementById("payerBalance");
  const gasRow = document.getElementById("gasRow");
  const switchWalletBtn = document.getElementById("switchWalletBtn");

  const readContractPromise = getReadOnlyContract();

  // The fee read when the page loaded. It is sent with the tip as the highest
  // fee the sender agrees to, so if it is raised between now and the wallet
  // prompt the transaction reverts instead of quietly overcharging.
  //
  // `mode` decides who pays and how: "passkey" routes a sponsored user
  // operation through the paymaster, "injected" is an ordinary transaction the
  // fan pays gas for themselves.
  let state = { mode: null, signer: null, address: null, quotedFeeBps: null };

  // The contract caps the note at 280 BYTES (`bytes(message).length`), while a
  // textarea's maxlength counts UTF-16 units. A note in French with accents, or
  // with a handful of emoji, clears the field and then reverts on-chain — after
  // the fan has signed and paid the gas. So count what the contract counts.
  const MAX_MESSAGE_BYTES = 280;
  const byteLength = (text) => new TextEncoder().encode(text).length;

  function refreshMessageCount() {
    const used = byteLength(messageInput.value);
    const left = MAX_MESSAGE_BYTES - used;
    const over = left < 0;
    messageCount.textContent = over ? `${-left} over the limit` : `${left} left`;
    messageCount.classList.toggle("is-over", over);
    return !over;
  }

  messageInput.addEventListener("input", refreshMessageCount);

  // Kept as the raw string the user typed. Going through Number() and back turns
  // 0.0000001 into "1e-7", which parseEther rejects outright, and silently
  // rounds anything past float precision.
  let selectedAmount = null;
  const AMOUNT_RE = /^\d{1,12}(\.\d{1,18})?$/;

  // The contract accepts any non-zero value, but a tip of dust costs more in gas
  // than it moves, and it cannot be sponsored either — ArcTipPaymaster's floor
  // is a whole USDC. A cent is the smallest amount that still means something.
  const MIN_AMOUNT = 0.01;

  // Text as text — the strings here include wallet/RPC errors, which can carry
  // attacker-influenced contract data.
  function showMsg(text, kind) {
    tipMsg.replaceChildren();
    if (!text) return;
    const box = document.createElement("div");
    box.className = `state-msg ${kind}`;
    box.textContent = text;
    tipMsg.appendChild(box);
  }

  amountBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      amountBtns.forEach((b) => b.classList.remove("is-active"));
      btn.classList.add("is-active");
      if (btn.dataset.amount === "custom") {
        customField.style.display = "block";
        selectedAmount = null;
        customInput.focus();
      } else {
        customField.style.display = "none";
        selectedAmount = btn.dataset.amount;
      }
      refreshAffordability();
    });
  });

  customInput.addEventListener("input", () => {
    const raw = customInput.value.trim();
    const valid = AMOUNT_RE.test(raw) && Number(raw) >= MIN_AMOUNT;
    selectedAmount = valid ? raw : null;
    if (raw && AMOUNT_RE.test(raw) && Number(raw) > 0 && Number(raw) < MIN_AMOUNT) {
      showMsg(`The smallest tip is ${MIN_AMOUNT} USDC.`, "info");
    } else {
      refreshAffordability();
    }
  });

  // --- wallet selection ---

  function walletChipNode(address) {
    const chip = document.createElement("span");
    chip.className = "wallet-chip";
    const dot = document.createElement("span");
    dot.className = "dot";
    chip.append(dot, document.createTextNode(shortAddress(address)));
    return chip;
  }

  /// Decide which ways in to offer. A fan with a browser wallet should never be
  /// nudged into making a second one, and a phone with no wallet at all should
  /// never be shown a dead "connect" button as its only option.
  async function setUpWalletOptions() {
    const passkeyReady = await ArcTipPasskey.available();
    if (passkeyReady) {
      const returning = ArcTipPasskey.hasCredential();
      passkeyBtn.hidden = returning;
      passkeySignInBtn.hidden = !returning;
      passkeyHint.hidden = returning;
    }
    // Always leave the browser-wallet path visible: it is the one that works
    // without a Circle key, and the fallback when a passkey prompt is refused.
    connectWalletBtn.hidden = false;
    sendBtn.hidden = true;
  }

  async function adoptPasskeyWallet(result) {
    state.mode = "passkey";
    state.address = result.address;
    state.signer = null;
    await showConnectedWallet({ sponsored: true });
  }

  async function showConnectedWallet({ sponsored }) {
    payWith.hidden = true;
    walletSummary.hidden = false;
    sendBtn.hidden = false;
    payerAddress.textContent = shortAddress(state.address);
    gasRow.hidden = !sponsored;
    walletChip.replaceChildren(walletChipNode(state.address));
    await refreshBalance();
  }

  /// The balance matters here in a way it does not on the creator side: the
  /// paymaster covers gas but never the tip, so a fresh passkey wallet holding
  /// nothing can still reach the send button. Showing the balance next to the
  /// amount is what makes that legible before the fan commits.
  let currentBalance = null;

  async function refreshBalance() {
    try {
      let raw;
      if (state.mode === "passkey") {
        raw = await ArcTipPasskey.balance();
      } else {
        const provider = await getReadOnlyProvider();
        raw = await provider.getBalance(state.address);
      }
      currentBalance = raw;
      payerBalance.textContent = `${Number(ethers.formatEther(raw)).toFixed(2)} USDC`;
    } catch {
      currentBalance = null;
      payerBalance.textContent = "—";
    }
    refreshAffordability();
  }

  /// Warn before the wallet prompt, not after it fails. A sponsored tip needs
  /// the amount and nothing more; an unsponsored one needs a little over, for
  /// gas the fan pays themselves.
  function refreshAffordability() {
    if (!state.address || currentBalance === null || !selectedAmount) {
      if (state.address) showMsg("", "");
      return;
    }
    let needed;
    try {
      needed = ethers.parseEther(selectedAmount);
    } catch {
      return;
    }
    if (currentBalance < needed) {
      const short = ethers.formatEther(needed - currentBalance);
      showMsg(
        `This wallet holds ${Number(ethers.formatEther(currentBalance)).toFixed(2)} USDC — ` +
          `${Number(short).toFixed(2)} short of a ${selectedAmount} USDC tip. ` +
          `Send USDC to ${state.address} on Arc, then try again.`,
        "info"
      );
    } else {
      showMsg("", "");
    }
  }

  passkeyBtn.addEventListener("click", async () => {
    passkeyBtn.disabled = true;
    const original = passkeyBtn.textContent;
    passkeyBtn.innerHTML = `<span class="spinner"></span> Setting up your wallet…`;
    showMsg("", "");
    try {
      const result = await ArcTipPasskey.createWallet(handle);
      await adoptPasskeyWallet(result);
    } catch (err) {
      showMsg(mapPasskeyError(err), "error");
    } finally {
      passkeyBtn.disabled = false;
      passkeyBtn.textContent = original;
    }
  });

  passkeySignInBtn.addEventListener("click", async () => {
    passkeySignInBtn.disabled = true;
    const original = passkeySignInBtn.textContent;
    passkeySignInBtn.innerHTML = `<span class="spinner"></span> Unlocking…`;
    showMsg("", "");
    try {
      const result = await ArcTipPasskey.signIn();
      await adoptPasskeyWallet(result);
    } catch (err) {
      showMsg(mapPasskeyError(err), "error");
    } finally {
      passkeySignInBtn.disabled = false;
      passkeySignInBtn.textContent = original;
    }
  });

  connectWalletBtn.addEventListener("click", async () => {
    connectWalletBtn.disabled = true;
    const original = connectWalletBtn.textContent;
    connectWalletBtn.innerHTML = `<span class="spinner"></span> Connecting…`;
    showMsg("", "");
    try {
      const { signer, address } = await connectWallet();
      state.mode = "injected";
      state.signer = signer;
      state.address = address;
      await showConnectedWallet({ sponsored: false });
    } catch (err) {
      showMsg(mapWeb3Error(err), "error");
    } finally {
      connectWalletBtn.disabled = false;
      connectWalletBtn.textContent = original;
    }
  });

  switchWalletBtn.addEventListener("click", async () => {
    if (state.mode === "passkey") ArcTipPasskey.forget();
    state = { mode: null, signer: null, address: null, quotedFeeBps: state.quotedFeeBps };
    currentBalance = null;
    walletSummary.hidden = true;
    payWith.hidden = false;
    walletChip.replaceChildren();
    showMsg("", "");
    await setUpWalletOptions();
  });

  /// WebAuthn throws DOMExceptions whose names say more than their messages,
  /// which are often empty. Map the ones a fan can actually act on.
  function mapPasskeyError(err) {
    if (!err) return "Something went wrong setting up your wallet.";
    if (err.name === "NotAllowedError") {
      return "Passkey prompt dismissed — nothing was created. Try again, or use a browser wallet.";
    }
    if (err.name === "InvalidStateError") {
      return "This device already has a wallet here. Choose “Sign in with your passkey” instead.";
    }
    if (err.name === "SecurityError") {
      return "Passkeys need a secure connection (https). Use a browser wallet on this page.";
    }
    return err.message || "Something went wrong setting up your wallet.";
  }

  async function init() {
    if (!handle) {
      handleTitle.textContent = "No handle in this link";
      handleLead.textContent =
        "An ArcTip link looks like arctip.app/@name — ask the creator for theirs.";
      return;
    }

    try {
      const readContract = await readContractPromise;
      const owner = await readContract.handleOwner(handle);
      if (owner === ethers.ZeroAddress) {
        handleTitle.textContent = `@${handle}`;
        handleLead.textContent = "";
        notFoundMsg.style.display = "block";
        return;
      }

      state.quotedFeeBps = await readContract.feeBps();

      handleTitle.textContent = `Tip @${handle}`;
      handleLead.textContent = "Sent as USDC, and it lands in about a second.";

      // Show who actually gets paid. This is a payments page: nobody should have
      // to take our word for where their money is going.
      recipientAddress.textContent = owner;
      recipientExplorer.href = `${ARC_TESTNET.blockExplorerUrls[0]}/address/${owner}`;

      tipCard.style.display = "block";

      // Silent: rebuilding a wallet from a credential already on this device
      // needs no biometric prompt, so a returning fan lands straight on Send.
      const resumed = await ArcTipPasskey.resume().catch(() => null);
      if (resumed) {
        await adoptPasskeyWallet(resumed);
      } else {
        await setUpWalletOptions();
      }
    } catch (err) {
      handleTitle.textContent = `@${handle}`;
      notFoundMsg.style.display = "block";
      notFoundMsg.textContent =
        err.message || "Couldn't reach Arc Testnet right now. Try again shortly.";
    }
  }

  sendBtn.addEventListener("click", async () => {
    showMsg("", "");

    if (!selectedAmount) {
      showMsg(`Pick an amount first, or enter a number of at least ${MIN_AMOUNT} USDC.`, "error");
      return;
    }
    if (!state.address) {
      showMsg("Choose how you want to pay first.", "error");
      return;
    }
    if (!refreshMessageCount()) {
      showMsg(
        `Your message is ${byteLength(messageInput.value) - MAX_MESSAGE_BYTES} over the limit. ` +
          "Accents and emoji each take more than one character's room.",
        "error"
      );
      return;
    }

    sendBtn.disabled = true;
    const msgText = messageInput.value.trim();
    const maxFeeBps = state.quotedFeeBps ?? 200;

    try {
      let txHash;

      if (state.mode === "passkey") {
        sendBtn.innerHTML = `<span class="spinner"></span> Confirm with Face ID…`;
        const result = await ArcTipPasskey.sendTip({
          handle,
          message: msgText,
          amount: selectedAmount,
          maxFeeBps,
        });
        txHash = result.txHash;
      } else {
        // Re-verify the chain here rather than trusting the switch made at
        // connect time: sending value to this address on the wrong chain
        // destroys it.
        sendBtn.innerHTML = `<span class="spinner"></span> Confirm in your wallet…`;
        const { contract } = await getVerifiedWriteContract();
        const tx = await contract.tip(handle, msgText, maxFeeBps, {
          value: ethers.parseEther(selectedAmount),
        });
        sendBtn.innerHTML = `<span class="spinner"></span> Waiting for confirmation…`;
        txHash = (await tx.wait()).hash;
      }

      if (typeof ArcTipNotifications !== "undefined") {
        ArcTipNotifications.notifyTip({
          handle,
          sender: state.address,
          amountUsdc: selectedAmount,
          message: msgText,
          txHash,
        });
      }

      receiptHandle.textContent = `@${handle}`;
      receiptAmount.textContent = `${selectedAmount} USDC`;
      receiptExplorerLink.href = `${ARC_TESTNET.blockExplorerUrls[0]}/tx/${txHash}`;
      tipCard.style.display = "none";
      receiptCard.style.display = "block";
    } catch (err) {
      showMsg(state.mode === "passkey" ? mapPasskeyError(err) : mapWeb3Error(err), "error");
    } finally {
      sendBtn.disabled = false;
      sendBtn.textContent = "Send tip";
    }
  });

  sendAnotherBtn.addEventListener("click", async () => {
    receiptCard.style.display = "none";
    tipCard.style.display = "block";
    amountBtns.forEach((b) => b.classList.remove("is-active"));
    customField.style.display = "none";
    customInput.value = "";
    messageInput.value = "";
    refreshMessageCount();
    selectedAmount = null;
    showMsg("", "");
    // The tip just left this wallet, so the balance on screen is stale.
    if (state.address) await refreshBalance();
  });

  watchWalletChanges();
  init();
})();

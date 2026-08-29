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
  const fundingPanel = document.getElementById("fundingPanel");
  const fundingAddress = document.getElementById("fundingAddress");
  const fundingQr = document.getElementById("fundingQr");
  const copyAddressBtn = document.getElementById("copyAddressBtn");
  const copyAddressMsg = document.getElementById("copyAddressMsg");
  const supportersEl = document.getElementById("supporters");
  const supportersList = document.getElementById("supportersList");
  const supportersNote = document.getElementById("supportersNote");
  const tabRecent = document.getElementById("tabRecent");
  const tabTop = document.getElementById("tabTop");

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

  // The QR library is only needed once a wallet turns out to be short of funds,
  // which is not the common case — so it is fetched then, not on page load.
  let qrLoader = null;
  function loadQrLib() {
    if (window.qrcode) return Promise.resolve();
    if (qrLoader) return qrLoader;
    qrLoader = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "vendor/qrcode.min.js";
      s.onload = resolve;
      s.onerror = () => { qrLoader = null; reject(new Error("qr")); };
      document.head.appendChild(s);
    });
    return qrLoader;
  }

  const QR_QUIET_ZONE = 4; // modules of margin — scanners fail without it

  async function drawFundingQr(text) {
    try {
      await loadQrLib();
      const qr = qrcode(0, "M");
      qr.addData(text);
      qr.make();
      const count = qr.getModuleCount();
      const total = count + QR_QUIET_ZONE * 2;
      const scale = Math.max(2, Math.floor(256 / total));
      const dim = scale * total;
      fundingQr.width = dim;
      fundingQr.height = dim;
      const ctx = fundingQr.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, dim, dim);
      ctx.fillStyle = "#14264A";
      for (let r = 0; r < count; r++) {
        for (let c = 0; c < count; c++) {
          if (qr.isDark(r, c)) {
            ctx.fillRect((c + QR_QUIET_ZONE) * scale, (r + QR_QUIET_ZONE) * scale, scale, scale);
          }
        }
      }
    } catch {
      // The address and its copy button carry the panel on their own.
      fundingQr.closest(".funding-qr").hidden = true;
    }
  }

  /// Show how to fund the wallet, but only when it actually needs funding —
  /// a panel that is always there is noise on the page that matters most.
  let fundingShownFor = null;

  async function showFunding(show) {
    fundingPanel.hidden = !show;
    if (!show || fundingShownFor === state.address) return;
    fundingShownFor = state.address;
    fundingAddress.textContent = state.address;
    await drawFundingQr(state.address);
  }

  if (copyAddressBtn) {
    copyAddressBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(state.address);
        copyAddressMsg.replaceChildren();
        const box = document.createElement("div");
        box.className = "state-msg success";
        box.textContent = "Address copied.";
        copyAddressMsg.appendChild(box);
        setTimeout(() => copyAddressMsg.replaceChildren(), 2500);
      } catch {
        copyAddressMsg.replaceChildren();
        const box = document.createElement("div");
        box.className = "state-msg error";
        box.textContent = "Couldn't copy — select the address above instead.";
        copyAddressMsg.appendChild(box);
      }
    });
  }

  /// Warn before the wallet prompt, not after it fails. A sponsored tip needs
  /// the amount and nothing more; an unsponsored one needs a little over, for
  /// gas the fan pays themselves.
  function refreshAffordability() {
    if (!state.address || currentBalance === null) {
      showFunding(false);
      return;
    }

    // An empty wallet needs funding whatever amount is picked — say so straight
    // away rather than waiting for the fan to choose before telling them.
    if (currentBalance === 0n) {
      showMsg("", "");
      showFunding(true);
      return;
    }

    if (!selectedAmount) {
      showMsg("", "");
      showFunding(false);
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
          `${Number(short).toFixed(2)} short of a ${selectedAmount} USDC tip.`,
        "info"
      );
      showFunding(true);
    } else {
      showMsg("", "");
      showFunding(false);
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
    fundingShownFor = null;
    fundingPanel.hidden = true;
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

  // ---- Supporters ----
  //
  // People tip to be seen doing it. Every ingredient is already on-chain in the
  // Tipped events, so this issues nothing and distributes nothing — it makes
  // visible what the chain already records.
  //
  // The contract is 36 days old and Arc produces a block every ~0.52s, so the
  // full history is ~5.9M blocks: 593 requests. Out of the question from a
  // browser. The window is therefore bounded, and the label says so rather than
  // implying these are all the supporters there have ever been.
  // eth_getLogs is capped per request: thirdweb (first in config.js) refuses
  // anything above 1000 blocks, Arc's own RPC allows 10000. So stay at 1000 and
  // win the range back by asking for many ranges at once — the chunks are
  // independent, so they cost one round trip rather than thirty.
  const LOG_CHUNK = 1000;
  const LOG_BATCH = 20;        // measured: 6 waves of 10 took ~9s in-browser
  const SUP_MAX_CHUNKS = 60;    // ~8.7 hours — measured at ~2s, no rate limit
  const SUP_TARGET = 25;        // enough to rank meaningfully
  const BLOCK_SECONDS = 0.52;

  let supporters = [];          // { sender, amount, message, block }
  let supportersView = "recent";

  function ago(blocksBack) {
    const s = blocksBack * BLOCK_SECONDS;
    if (s < 90) return "just now";
    if (s < 5400) return `${Math.round(s / 60)} min ago`;
    return `${Math.round(s / 3600)} h ago`;
  }

  function supporterRow({ sender, amount, message, block }, latest, extra) {
    const row = document.createElement("div");
    row.className = "supporter";

    const who = document.createElement("span");
    who.className = "who";
    if (extra && extra.rank) {
      const r = document.createElement("span");
      r.className = "rank";
      r.textContent = extra.rank;
      who.appendChild(r);
    }
    who.appendChild(document.createTextNode(shortAddress(sender)));
    if (extra && extra.badge) {
      const b = document.createElement("span");
      b.className = "badge";
      b.textContent = extra.badge;
      who.appendChild(b);
    }

    const amt = document.createElement("span");
    amt.className = "amt";
    amt.textContent = `${Number(ethers.formatEther(amount)).toFixed(2)} USDC`;

    row.append(who, amt);

    // The note is written by a stranger: textContent, never innerHTML.
    if (message) {
      const note = document.createElement("p");
      note.className = "note";
      note.textContent = `“${message}”`;
      row.appendChild(note);
    }
    if (block != null) {
      const when = document.createElement("span");
      when.className = "when";
      when.textContent = ago(latest - block);
      row.appendChild(when);
    }
    return row;
  }

  function renderSupporters(latest) {
    if (supporters.length === 0) return;

    if (supportersView === "recent") {
      const rows = supporters.slice(-12).reverse();
      // Seniority that cannot be bought — the earliest tip in what we can see.
      const earliest = supporters.reduce((a, b) => (a.block <= b.block ? a : b));
      supportersList.replaceChildren(
        ...rows.map((t) =>
          supporterRow(t, latest, t === earliest ? { badge: "earliest here" } : null)
        )
      );
    } else {
      // Ranked by total given, which is the number a supporter can move.
      const totals = new Map();
      for (const t of supporters) {
        const key = t.sender.toLowerCase();
        const cur = totals.get(key) || { sender: t.sender, amount: 0n, block: t.block, message: "" };
        cur.amount += t.amount;
        cur.block = Math.min(cur.block, t.block);
        totals.set(key, cur);
      }
      const ranked = [...totals.values()].sort((a, b) => (b.amount > a.amount ? 1 : -1)).slice(0, 10);
      supportersList.replaceChildren(
        ...ranked.map((t, i) => supporterRow(t, latest, { rank: `#${i + 1}` }))
      );
    }
  }

  /// Loaded after the tip form is usable: this is the page where someone is
  /// about to pay, and it must not wait on a log scan to become interactive.
  async function loadSupporters(recipient) {
    try {
      const readContract = await readContractPromise;
      const provider = readContract.runner.provider;
      const latest = await provider.getBlockNumber();
      const filter = readContract.filters.Tipped(null, recipient);

      const found = [];
      let to = latest;
      for (let done = 0; done < SUP_MAX_CHUNKS && found.length < SUP_TARGET && to > 0; done += LOG_BATCH) {
        const ranges = [];
        for (let i = 0; i < LOG_BATCH && done + i < SUP_MAX_CHUNKS && to > 0; i++) {
          const from = Math.max(0, to - LOG_CHUNK);
          ranges.push([from, to]);
          to = from - 1;
        }
        const batches = await Promise.all(
          ranges.map(([f, t]) => readContract.queryFilter(filter, f, t).catch(() => []))
        );
        for (const b of batches.reverse()) {
          found.unshift(...b.map((e) => ({
            sender: e.args.sender,
            amount: e.args.amount,
            message: e.args.message,
            block: e.blockNumber,
          })));
        }
      }
      if (found.length === 0) return;

      supporters = found;
      supportersEl.hidden = false;
      renderSupporters(latest);

      const hours = ((SUP_MAX_CHUNKS * LOG_CHUNK * BLOCK_SECONDS) / 3600).toFixed(1);
      supportersNote.textContent =
        `Read straight from the chain — the last ${hours} hours of tips to this handle. ` +
        `Nothing here is issued or awarded: it is what the Tipped events already say.`;

      tabRecent.addEventListener("click", () => {
        supportersView = "recent";
        tabRecent.classList.add("is-on"); tabTop.classList.remove("is-on");
        renderSupporters(latest);
      });
      tabTop.addEventListener("click", () => {
        supportersView = "top";
        tabTop.classList.add("is-on"); tabRecent.classList.remove("is-on");
        renderSupporters(latest);
      });
    } catch (err) {
      // Best-effort: the tip form is the page's job, this is decoration. But a
      // silent catch here cost an hour of debugging once — leave a trace.
      console.debug("supporters:", err);
    }
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

      // After the form is usable, never before it.
      loadSupporters(owner);

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

(() => {
  const HANDLE_RE = /^[a-z0-9_]{1,32}$/;

  const connectBtn = document.getElementById("connectBtn");
  const connectMsg = document.getElementById("connectMsg");
  const connectCard = document.getElementById("connectCard");
  const claimCard = document.getElementById("claimCard");
  const dashboardCard = document.getElementById("dashboardCard");
  const handleInput = document.getElementById("handleInput");
  const claimBtn = document.getElementById("claimBtn");
  const claimMsg = document.getElementById("claimMsg");
  const tipLinkInput = document.getElementById("tipLinkInput");
  const copyLinkBtn = document.getElementById("copyLinkBtn");
  const copyMsg = document.getElementById("copyMsg");
  const tipList = document.getElementById("tipList");
  const walletChip = document.getElementById("walletChip");
  const qrCanvas = document.getElementById("qrCanvas");
  const downloadQrBtn = document.getElementById("downloadQrBtn");
  const qrMsg = document.getElementById("qrMsg");

  let state = { signer: null, address: null, writeContract: null };
  const readContractPromise = getReadOnlyContract();

  // Always render text as text: several call sites pass wallet/RPC error strings,
  // which can carry attacker-influenced contract data.
  function showMsg(el, text, kind) {
    el.replaceChildren();
    if (!text) return;
    const box = document.createElement("div");
    box.className = `state-msg ${kind}`;
    box.textContent = text;
    el.appendChild(box);
  }

  function hintNode(text) {
    const p = document.createElement("p");
    p.className = "hint";
    p.textContent = text;
    return p;
  }

  // The share link is the whole product surface — keep it short enough to sit in
  // a bio or under a stream. /@handle is served by a rewrite (see vercel.json).
  function tipLinkFor(handle) {
    return `${window.location.origin}/@${handle}`;
  }

  // QR is generated locally rather than through an image API: a creator's handle
  // is their identity here, and it has no business being sent to a third party
  // just to draw a square.
  const QR_QUIET_ZONE = 4; // modules of margin — scanners fail without it

  function drawQr(canvas, text, targetPx) {
    const qr = qrcode(0, "M");
    qr.addData(text);
    qr.make();

    const count = qr.getModuleCount();
    const total = count + QR_QUIET_ZONE * 2;
    const scale = Math.max(1, Math.floor(targetPx / total));
    const dim = scale * total;

    canvas.width = dim;
    canvas.height = dim;
    const ctx = canvas.getContext("2d");
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
    return canvas;
  }

  async function findOwnHandle(address) {
    // Direct mapping lookup — not a log scan. Arc testnet is already past block
    // 50M, and public RPCs reject/rate-limit unbounded eth_getLogs queries, so
    // "search history for my registration" doesn't scale. ownerHandle() does.
    const readContract = await readContractPromise;
    const handle = await readContract.ownerHandle(address);
    return handle || null;
  }

  // Recent-tips is a best-effort convenience feature, so it only looks at a
  // bounded recent window and fails quietly rather than breaking the dashboard —
  // see findOwnHandle for why an unbounded query isn't an option here.
  const RECENT_TIPS_BLOCK_WINDOW = 1000;

  async function loadRecentTips(address) {
    try {
      const readContract = await readContractPromise;
      const provider = readContract.runner.provider;
      const latest = await provider.getBlockNumber();
      const fromBlock = Math.max(0, latest - RECENT_TIPS_BLOCK_WINDOW);
      const events = await readContract.queryFilter(
        readContract.filters.Tipped(null, address),
        fromBlock,
        latest
      );
      if (events.length === 0) {
        tipList.replaceChildren(
          hintNode(
            `No tips in the last ${RECENT_TIPS_BLOCK_WINDOW} blocks — they'll show up here as they arrive.`
          )
        );
        return;
      }
      tipList.replaceChildren(
        ...events.slice(-10).reverse().map((e) => tipRow(e.args))
      );
    } catch (err) {
      tipList.replaceChildren(
        hintNode(
          "Couldn't load recent tips right now — your page still works, this is just the activity list."
        )
      );
    }
  }

  // The tip message is written by whoever sent the tip, and the contract puts no
  // limit on its length or contents. Build this row as DOM nodes with textContent
  // rather than an HTML string: a message like `<img src=x onerror=...>` would
  // otherwise execute right here, on the one page where the creator's wallet is
  // connected. The length cap keeps a very long message from wrecking the layout.
  const MAX_MESSAGE_CHARS = 140;

  function tipRow({ sender, amount, message }) {
    const row = document.createElement("div");
    row.className = "tip-row";

    const who = document.createElement("span");
    who.className = "who";
    const note = message.length > MAX_MESSAGE_CHARS
      ? `${message.slice(0, MAX_MESSAGE_CHARS)}…`
      : message;
    who.textContent = note ? `${shortAddress(sender)} — "${note}"` : shortAddress(sender);

    const amt = document.createElement("span");
    amt.className = "amt";
    amt.textContent = `${ethers.formatEther(amount)} USDC`;

    row.append(who, amt);
    return row;
  }

  async function refreshState() {
    walletChip.innerHTML = `<span class="wallet-chip"><span class="dot"></span>${shortAddress(state.address)}</span>`;
    connectCard.style.display = "none";

    const handle = await findOwnHandle(state.address);
    if (handle) {
      claimCard.style.display = "none";
      dashboardCard.style.display = "block";
      const link = tipLinkFor(handle);
      tipLinkInput.value = link;
      state.handle = handle;
      drawQr(qrCanvas, link, 200);
      await loadRecentTips(state.address);
    } else {
      claimCard.style.display = "block";
      dashboardCard.style.display = "none";
    }
  }

  connectBtn.addEventListener("click", async () => {
    connectBtn.disabled = true;
    connectBtn.innerHTML = `<span class="spinner"></span> Connecting…`;
    showMsg(connectMsg, "", "");
    try {
      const { signer, address } = await connectWallet();
      state.signer = signer;
      state.address = address;
      state.writeContract = getWriteContract(signer);
      await refreshState();
    } catch (err) {
      showMsg(connectMsg, err.message || "Could not connect wallet.", "error");
    } finally {
      connectBtn.disabled = false;
      connectBtn.textContent = "Connect wallet";
    }
  });

  claimBtn.addEventListener("click", async () => {
    const handle = handleInput.value.trim().toLowerCase();
    showMsg(claimMsg, "", "");

    if (!HANDLE_RE.test(handle)) {
      showMsg(claimMsg, "Handles can only use lowercase letters, numbers, and underscores (1–32 characters).", "error");
      return;
    }

    claimBtn.disabled = true;
    claimBtn.innerHTML = `<span class="spinner"></span> Checking availability…`;
    try {
      const readContract = await readContractPromise;
      const taken = await readContract.isHandleTaken(handle);
      if (taken) {
        showMsg(claimMsg, `@${handle} is already claimed. Try another one.`, "error");
        return;
      }

      claimBtn.innerHTML = `<span class="spinner"></span> Confirm in your wallet…`;
      const tx = await state.writeContract.register(handle);
      claimBtn.innerHTML = `<span class="spinner"></span> Waiting for confirmation…`;
      await tx.wait();

      showMsg(claimMsg, `@${handle} is yours.`, "success");
      await refreshState();
    } catch (err) {
      showMsg(claimMsg, err.shortMessage || err.message || "Could not claim handle.", "error");
    } finally {
      claimBtn.disabled = false;
      claimBtn.textContent = "Claim handle";
    }
  });

  downloadQrBtn.addEventListener("click", () => {
    // Redraw large: the on-screen canvas is ~200px, which looks blocky on a
    // stream overlay or in print.
    const big = drawQr(document.createElement("canvas"), tipLinkInput.value, 1024);
    big.toBlob((blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `arctip-${state.handle || "qr"}.png`;
      a.click();
      URL.revokeObjectURL(url);
      showMsg(qrMsg, "Saved.", "success");
      setTimeout(() => showMsg(qrMsg, "", ""), 2000);
    }, "image/png");
  });

  copyLinkBtn.addEventListener("click", async () => {
    await navigator.clipboard.writeText(tipLinkInput.value);
    showMsg(copyMsg, "Link copied.", "success");
    setTimeout(() => showMsg(copyMsg, "", ""), 2000);
  });
})();

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

  let state = { signer: null, address: null, writeContract: null };
  const readContractPromise = getReadOnlyContract();

  function showMsg(el, text, kind) {
    el.innerHTML = text ? `<div class="state-msg ${kind}">${text}</div>` : "";
  }

  function tipLinkFor(handle) {
    const url = new URL("tip.html", window.location.href);
    url.searchParams.set("handle", handle);
    return url.toString();
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
        tipList.innerHTML = `<p class="hint">No tips in the last ${RECENT_TIPS_BLOCK_WINDOW} blocks — they'll show up here as they arrive.</p>`;
        return;
      }
      const rows = events
        .slice(-10)
        .reverse()
        .map((e) => {
          const { sender, amount, message } = e.args;
          const note = message ? ` — "${message}"` : "";
          return `<div class="tip-row"><span class="who">${shortAddress(sender)}${note}</span><span class="amt">${ethers.formatEther(amount)} USDC</span></div>`;
        })
        .join("");
      tipList.innerHTML = rows;
    } catch (err) {
      tipList.innerHTML = `<p class="hint">Couldn't load recent tips right now — your page still works, this is just the activity list.</p>`;
    }
  }

  async function refreshState() {
    walletChip.innerHTML = `<span class="wallet-chip"><span class="dot"></span>${shortAddress(state.address)}</span>`;
    connectCard.style.display = "none";

    const handle = await findOwnHandle(state.address);
    if (handle) {
      claimCard.style.display = "none";
      dashboardCard.style.display = "block";
      tipLinkInput.value = tipLinkFor(handle);
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

  copyLinkBtn.addEventListener("click", async () => {
    await navigator.clipboard.writeText(tipLinkInput.value);
    showMsg(copyMsg, "Link copied.", "success");
    setTimeout(() => showMsg(copyMsg, "", ""), 2000);
  });
})();

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
  const sendBtn = document.getElementById("sendBtn");
  const tipMsg = document.getElementById("tipMsg");
  const walletChip = document.getElementById("walletChip");
  const receiptHandle = document.getElementById("receiptHandle");
  const receiptAmount = document.getElementById("receiptAmount");
  const receiptExplorerLink = document.getElementById("receiptExplorerLink");
  const recipientAddress = document.getElementById("recipientAddress");
  const recipientExplorer = document.getElementById("recipientExplorer");
  const sendAnotherBtn = document.getElementById("sendAnotherBtn");

  const readContractPromise = getReadOnlyContract();
  // The fee read when the page loaded. It is sent with the tip as the highest
  // fee the sender agrees to, so if it is raised between now and the wallet
  // prompt the transaction reverts instead of quietly overcharging.
  let state = { signer: null, address: null, quotedFeeBps: null };

  // Kept as the raw string the user typed. Going through Number() and back turns
  // 0.0000001 into "1e-7", which parseEther rejects outright, and silently
  // rounds anything past float precision.
  let selectedAmount = null;
  const AMOUNT_RE = /^\d{1,12}(\.\d{1,18})?$/;

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
    });
  });

  customInput.addEventListener("input", () => {
    const raw = customInput.value.trim();
    selectedAmount = AMOUNT_RE.test(raw) && Number(raw) > 0 ? raw : null;
  });

  async function init() {
    if (!handle) {
      handleTitle.textContent = "No handle in this link";
      handleLead.textContent =
        "An ArcTip link looks like arctip.xyz/@name — ask the creator for theirs.";
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
      showMsg("Pick an amount first, or enter a valid number.", "error");
      return;
    }

    sendBtn.disabled = true;
    try {
      if (!state.signer) {
        sendBtn.innerHTML = `<span class="spinner"></span> Connecting wallet…`;
        const { signer, address } = await connectWallet();
        state.signer = signer;
        state.address = address;
        walletChip.replaceChildren(walletChipNode(address));
      }

      // Re-verify the chain here rather than trusting the switch made at connect
      // time: sending value to this address on the wrong chain destroys it.
      sendBtn.innerHTML = `<span class="spinner"></span> Confirm in your wallet…`;
      const { contract } = await getVerifiedWriteContract();

      const value = ethers.parseEther(selectedAmount);
      const msgText = messageInput.value.trim();
      const tx = await contract.tip(
        handle,
        msgText,
        state.quotedFeeBps ?? 200,
        { value }
      );

      sendBtn.innerHTML = `<span class="spinner"></span> Waiting for confirmation…`;
      const receipt = await tx.wait();

      if (typeof ArcTipNotifications !== "undefined") {
        ArcTipNotifications.notifyTip({
          handle,
          sender: state.address,
          amountUsdc: selectedAmount,
          message: msgText,
          txHash: receipt.hash,
        });
      }

      receiptHandle.textContent = `@${handle}`;
      receiptAmount.textContent = `${selectedAmount} USDC`;
      receiptExplorerLink.href = `${ARC_TESTNET.blockExplorerUrls[0]}/tx/${receipt.hash}`;
      tipCard.style.display = "none";
      receiptCard.style.display = "block";
    } catch (err) {
      showMsg(mapWeb3Error(err), "error");
    } finally {
      sendBtn.disabled = false;
      sendBtn.textContent = state.signer ? "Send tip" : "Connect wallet to tip";
    }
  });

  sendAnotherBtn.addEventListener("click", () => {
    receiptCard.style.display = "none";
    tipCard.style.display = "block";
    amountBtns.forEach((b) => b.classList.remove("is-active"));
    customField.style.display = "none";
    customInput.value = "";
    messageInput.value = "";
    selectedAmount = null;
    showMsg("", "");
  });

  function walletChipNode(address) {
    const chip = document.createElement("span");
    chip.className = "wallet-chip";
    const dot = document.createElement("span");
    dot.className = "dot";
    chip.append(dot, document.createTextNode(shortAddress(address)));
    return chip;
  }

  watchWalletChanges();
  init();
})();

(() => {
  const params = new URLSearchParams(window.location.search);
  const handle = (params.get("handle") || "").trim().toLowerCase();

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

  const readContractPromise = getReadOnlyContract();
  let selectedAmount = null;
  let state = { signer: null, address: null, writeContract: null };

  function showMsg(text, kind) {
    tipMsg.innerHTML = text ? `<div class="state-msg ${kind}">${text}</div>` : "";
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
        selectedAmount = Number(btn.dataset.amount);
      }
    });
  });

  customInput.addEventListener("input", () => {
    const v = Number(customInput.value);
    selectedAmount = v > 0 ? v : null;
  });

  async function init() {
    if (!handle) {
      handleTitle.textContent = "No handle specified";
      handleLead.textContent = "This link is missing a ?handle= — ask the creator for their ArcTip link.";
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

      handleTitle.textContent = `Tip @${handle}`;
      handleLead.textContent = `Sent as USDC, settled on Arc in one to two seconds.`;
      tipCard.style.display = "block";
    } catch (err) {
      handleTitle.textContent = `@${handle}`;
      notFoundMsg.style.display = "block";
      notFoundMsg.innerHTML = err.message || "Couldn't reach Arc Testnet right now. Try again shortly.";
    }
  }

  sendBtn.addEventListener("click", async () => {
    showMsg("", "");

    if (!selectedAmount || selectedAmount <= 0) {
      showMsg("Pick an amount first.", "error");
      return;
    }

    sendBtn.disabled = true;
    try {
      if (!state.signer) {
        sendBtn.innerHTML = `<span class="spinner"></span> Connecting wallet…`;
        const { signer, address } = await connectWallet();
        state.signer = signer;
        state.address = address;
        state.writeContract = getWriteContract(signer);
        walletChip.innerHTML = `<span class="wallet-chip"><span class="dot"></span>${shortAddress(address)}</span>`;
      }

      sendBtn.innerHTML = `<span class="spinner"></span> Confirm in your wallet…`;
      const value = ethers.parseEther(String(selectedAmount));
      const message = messageInput.value.trim();
      const tx = await state.writeContract.tip(handle, message, { value });

      sendBtn.innerHTML = `<span class="spinner"></span> Waiting for confirmation…`;
      const receipt = await tx.wait();

      receiptHandle.textContent = `@${handle}`;
      receiptAmount.textContent = `${selectedAmount} USDC`;
      receiptExplorerLink.href = `${ARC_TESTNET.blockExplorerUrls[0]}/tx/${receipt.hash}`;
      tipCard.style.display = "none";
      receiptCard.style.display = "block";
    } catch (err) {
      showMsg(err.shortMessage || err.message || "Could not send tip.", "error");
    } finally {
      sendBtn.disabled = false;
      sendBtn.textContent = state.signer ? "Send tip" : "Connect wallet to tip";
    }
  });

  init();
})();

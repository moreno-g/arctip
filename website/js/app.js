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
  const shareCardCanvas = document.getElementById("shareCardCanvas");
  const downloadCardBtn = document.getElementById("downloadCardBtn");
  const cardMsg = document.getElementById("cardMsg");
  const shareCardBtn = document.getElementById("shareCardBtn");
  const copyCardBtn = document.getElementById("copyCardBtn");
  const shareXLink = document.getElementById("shareXLink");
  const shareTgLink = document.getElementById("shareTgLink");

  // Transactions build their own contract via getVerifiedWriteContract, which
  // re-checks the chain each time, so nothing is cached from connect time here.
  let state = { signer: null, address: null, handle: null };
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

  // The tip message is written by whoever sent the tip. Build this row as DOM
  // nodes with textContent rather than an HTML string: a message like
  // `<img src=x onerror=...>` would otherwise execute right here, on the one page
  // where the creator's wallet is connected. The contract caps length now, but
  // the truncation stays as a second line of defence against a future change.
  const MAX_MESSAGE_CHARS = 280; // matches MAX_MESSAGE_LENGTH in the contract

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

  // A share card the creator can post as-is. Drawn at a fixed 1200x630 and then
  // scaled by CSS, so the download is full quality regardless of preview size.
  const CARD_W = 1200;
  const CARD_H = 630;
  const TEXT_COLUMN = 620; // width available left of the QR plate

  function drawShareCard(canvas, handle, link) {
    canvas.width = CARD_W;
    canvas.height = CARD_H;
    const x = canvas.getContext("2d");

    x.fillStyle = "#14264A";
    x.fillRect(0, 0, CARD_W, CARD_H);

    // the brand arc, bleeding off the right edge behind the QR
    x.save();
    x.globalAlpha = 0.4;
    x.strokeStyle = "#C9832A";
    x.lineWidth = 18;
    x.lineCap = "round";
    x.beginPath();
    x.arc(1180, 315, 300, Math.PI * 0.68, Math.PI * 1.32);
    x.stroke();
    x.restore();

    const rule = x.createLinearGradient(0, 0, CARD_W, 0);
    rule.addColorStop(0, "#C9832A");
    rule.addColorStop(0.22, "#C9832A");
    rule.addColorStop(1, "rgba(201,131,42,0)");
    x.fillStyle = rule;
    x.fillRect(0, 0, CARD_W, 6);

    const L = 80;
    x.textBaseline = "alphabetic";
    x.textAlign = "left";

    x.font = '20px "Space Mono", monospace';
    x.letterSpacing = "2.6px";
    x.fillStyle = "#C9832A";
    x.fillText("{ TIP ME IN USDC }", L, 120);
    x.letterSpacing = "0px";

    // the handle is the point of the card, so let it fill the space available
    let size = 92;
    x.letterSpacing = "-1.5px";
    while (size > 34) {
      x.font = `400 ${size}px "Space Grotesk", sans-serif`;
      if (x.measureText("@" + handle).width <= TEXT_COLUMN) break;
      size -= 2;
    }
    x.font = `400 ${size}px "Space Grotesk", sans-serif`;
    x.fillStyle = "#ffffff";
    x.fillText("@" + handle, L, 235);
    x.letterSpacing = "0px";

    x.font = '26px "DM Sans", sans-serif';
    x.fillStyle = "#B9C3D6";
    x.fillText("Send me a tip in USDC — it lands in about a second,", L, 300);
    x.fillText("no account and no address to copy.", L, 338);

    x.fillStyle = "rgba(255,255,255,.16)";
    x.fillRect(L, 400, TEXT_COLUMN, 1);

    // Fit the URL too, not just the handle: a long handle used to run the URL
    // straight under the QR plate.
    const shown = link.replace(/^https?:\/\//, "");
    let urlSize = 30;
    while (urlSize > 14) {
      x.font = `${urlSize}px "Space Mono", monospace`;
      if (x.measureText(shown).width <= TEXT_COLUMN) break;
      urlSize -= 1;
    }
    x.font = `${urlSize}px "Space Mono", monospace`;
    x.fillStyle = "#ffffff";
    x.fillText(shown, L, 452);

    x.font = '19px "Space Mono", monospace';
    x.letterSpacing = "1.5px";
    x.fillStyle = "#7E8CA8";
    x.fillText("POWERED BY ARCTIP  ·  BUILT ON ARC", L, 520);
    x.letterSpacing = "0px";

    // QR on a white plate so it stays scannable against the navy
    const plate = 300;
    const px = CARD_W - plate - 80;
    const py = (CARD_H - plate) / 2;
    x.fillStyle = "#ffffff";
    x.beginPath();
    x.roundRect(px, py, plate, plate, 16);
    x.fill();

    const qr = drawQr(document.createElement("canvas"), link, plate - 24);
    x.drawImage(qr, px + (plate - qr.width) / 2, py + (plate - qr.height) / 2);

    return canvas;
  }

  async function refreshState() {
    const chip = document.createElement("span");
    chip.className = "wallet-chip";
    const dot = document.createElement("span");
    dot.className = "dot";
    chip.append(dot, document.createTextNode(shortAddress(state.address)));
    walletChip.replaceChildren(chip);
    connectCard.style.display = "none";

    const handle = await findOwnHandle(state.address);
    if (handle) {
      claimCard.style.display = "none";
      dashboardCard.style.display = "block";
      const link = tipLinkFor(handle);
      tipLinkInput.value = link;
      state.handle = handle;
      drawQr(qrCanvas, link, 200);
      drawShareCard(shareCardCanvas, handle, link);
      await setUpShareActions(link);
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

      // Re-verify the chain rather than trusting the switch made at connect time.
      claimBtn.innerHTML = `<span class="spinner"></span> Confirm in your wallet…`;
      const { contract } = await getVerifiedWriteContract();
      const tx = await contract.register(handle);
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

  // Sharing an image is split in two because no platform lets a link pre-attach a
  // file: X, Telegram and Discord intent URLs carry text and a URL, nothing more.
  // So the image travels either through the OS share sheet (mobile) or the
  // clipboard (desktop), while the intent links fall back to text + the tip link,
  // which still renders a preview card thanks to the page's Open Graph tags.
  const SHARE_TEXT = "You can now tip me in USDC — it lands in about a second, no account needed.";

  function cardBlob() {
    return new Promise((resolve) => shareCardCanvas.toBlob(resolve, "image/png"));
  }

  async function canShareCardFile() {
    if (!navigator.canShare) return false;
    try {
      const probe = new File([new Blob([""], { type: "image/png" })], "probe.png", {
        type: "image/png",
      });
      return navigator.canShare({ files: [probe] });
    } catch {
      return false;
    }
  }

  async function setUpShareActions(link) {
    const q = (s) => encodeURIComponent(s);
    shareXLink.href = `https://twitter.com/intent/tweet?text=${q(SHARE_TEXT)}&url=${q(link)}`;
    shareTgLink.href = `https://t.me/share/url?url=${q(link)}&text=${q(SHARE_TEXT)}`;

    shareCardBtn.hidden = !(await canShareCardFile());
    copyCardBtn.hidden = !(navigator.clipboard && window.ClipboardItem);
  }

  shareCardBtn.addEventListener("click", async () => {
    try {
      const blob = await cardBlob();
      const file = new File([blob], `arctip-${state.handle || "card"}.png`, {
        type: "image/png",
      });
      await navigator.share({
        files: [file],
        text: `${SHARE_TEXT} ${tipLinkInput.value}`,
      });
    } catch (err) {
      if (err.name === "AbortError") return; // user dismissed the sheet
      showMsg(cardMsg, "Couldn't open the share sheet — use Copy image or Download instead.", "error");
    }
  });

  copyCardBtn.addEventListener("click", async () => {
    try {
      const blob = await cardBlob();
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      showMsg(cardMsg, "Image copied — paste it straight into a post.", "success");
      setTimeout(() => showMsg(cardMsg, "", ""), 3000);
    } catch (err) {
      showMsg(cardMsg, "Your browser blocked the copy — use Download instead.", "error");
    }
  });

  function downloadCanvas(canvas, filename, msgEl) {
    canvas.toBlob((blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      showMsg(msgEl, "Saved.", "success");
      setTimeout(() => showMsg(msgEl, "", ""), 2000);
    }, "image/png");
  }

  downloadCardBtn.addEventListener("click", () => {
    downloadCanvas(shareCardCanvas, `arctip-card-${state.handle || "share"}.png`, cardMsg);
  });

  downloadQrBtn.addEventListener("click", () => {
    // Redraw large: the on-screen canvas is ~200px, which looks blocky on a
    // stream overlay or in print.
    const big = drawQr(document.createElement("canvas"), tipLinkInput.value, 1024);
    downloadCanvas(big, `arctip-qr-${state.handle || "qr"}.png`, qrMsg);
  });

  copyLinkBtn.addEventListener("click", async () => {
    await navigator.clipboard.writeText(tipLinkInput.value);
    showMsg(copyMsg, "Link copied.", "success");
    setTimeout(() => showMsg(copyMsg, "", ""), 2000);
  });

  watchWalletChanges();
})();

// Real-time creator notification dispatch helper (Discord Webhooks, Stream Overlays & Telegram)
const ArcTipNotifications = (() => {
  const WEBHOOK_KEY = "arctip_creator_webhook_url";

  function getWebhookUrl() {
    return localStorage.getItem(WEBHOOK_KEY) || "";
  }

  function setWebhookUrl(url) {
    if (url) {
      localStorage.setItem(WEBHOOK_KEY, url);
    } else {
      localStorage.removeItem(WEBHOOK_KEY);
    }
  }

  async function notifyTip({ handle, sender, amountUsdc, message, txHash }) {
    const webhookUrl = getWebhookUrl();
    if (!webhookUrl) return false;

    const payload = {
      content: `🎉 **New Tip Received on ArcTip!**`,
      embeds: [
        {
          title: `Tip for @${handle}`,
          description: message ? `"${message}"` : "*No message attached*",
          color: 13206314, // #C9832A
          fields: [
            { name: "Amount", value: `${amountUsdc} USDC`, inline: true },
            { name: "From", value: `${sender.slice(0, 6)}...${sender.slice(-4)}`, inline: true },
            { name: "Network", value: "Arc Testnet", inline: true },
          ],
          url: `https://testnet.arcscan.app/tx/${txHash}`,
          footer: { text: "ArcTip · Settlement < 2s" },
          timestamp: new Date().toISOString(),
        },
      ],
    };

    try {
      await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      return true;
    } catch {
      return false;
    }
  }

  return {
    getWebhookUrl,
    setWebhookUrl,
    notifyTip,
  };
})();

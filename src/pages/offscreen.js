// MV3 service worker 没有 DOM，剪贴板写入必须在 offscreen document 中完成。
chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
    if (!message || message.target !== "offscreen" || message.type !== "copy") {
        return;
    }

    try {
        var area = document.createElement("textarea");
        area.value = message.text || "";
        area.style.position = "fixed";
        area.style.opacity = "0";
        document.body.appendChild(area);
        area.focus();
        area.select();
        document.execCommand("copy", false, null);
        area.remove();
        sendResponse({ ok: true });
    } catch (error) {
        sendResponse({ ok: false, error: String(error) });
    }
    return true;
});

// Linkclump MV3 service worker
import { SettingsManager } from "./settings_manager.js";

const settingsManager = new SettingsManager();
const VISITED_KEY = "lcVisitedUrls";
const JOBS_KEY = "lcJobs";
const KEEPALIVE_ALARM = "lc-keepalive";
const MAX_VISITED = 20000;

// 仅在当前 service worker 实例内有效，用于避免重复排程
const armedJobs = new Set();

const URLS_WITH_TITLES = 0;
const URLS_ONLY = 1;
const URLS_ONLY_SPACE_SEPARATED = 2;
const TITLES_ONLY = 3;
const AS_LINK_HTML = 4;
const AS_LIST_LINK_HTML = 5;
const AS_MARKDOWN = 6;

function uniqueUrls(urls) {
    const seen = new Set();
    const result = [];
    for (const item of urls) {
        if (!seen.has(item.url)) {
            seen.add(item.url);
            result.push(item);
        }
    }
    return result;
}

function pad(number, length) {
    let str = "" + number;
    while (str.length < length) {
        str = "0" + str;
    }
    return str;
}

function timeConverter(date) {
    return date.getFullYear() + "-" + pad(date.getMonth() + 1, 2) + "-" + pad(date.getDate(), 2) +
        " " + pad(date.getHours(), 2) + ":" + pad(date.getMinutes(), 2) + ":" + pad(date.getSeconds(), 2);
}

function formatLink(item, copyFormat) {
    const url = item.url || "";
    const title = item.title || "";
    switch (parseInt(copyFormat)) {
    case URLS_WITH_TITLES: return title + "\t" + url + "\n";
    case URLS_ONLY: return url + "\n";
    case URLS_ONLY_SPACE_SEPARATED: return url + " ";
    case TITLES_ONLY: return title + "\n";
    case AS_LINK_HTML: return '<a href="' + url + '">' + title + "</a>\n";
    case AS_LIST_LINK_HTML: return '<li><a href="' + url + '">' + title + "</a></li>\n";
    case AS_MARKDOWN: return "[" + title + "](" + url + ")\n";
    default: return title + "\t" + url + "\n";
    }
}

/* ---------- 剪贴板（offscreen document） ---------- */

async function ensureOffscreen() {
    if (chrome.runtime.getContexts) {
        const contexts = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] });
        if (contexts && contexts.length > 0) {
            return;
        }
    }
    try {
        await chrome.offscreen.createDocument({
            url: "pages/offscreen.html",
            reasons: ["CLIPBOARD"],
            justification: "把框选到的链接写入系统剪贴板"
        });
    } catch (error) {
        // 已经存在时 createDocument 会抛错，忽略即可
    }
}

async function copyToClipboard(text) {
    await ensureOffscreen();
    await chrome.runtime.sendMessage({ target: "offscreen", type: "copy", text: text });
}

/* ---------- 延时打开 / 延时关闭队列 ----------
   service worker 空闲 30 秒会被回收，setTimeout 状态会丢。
   队列存 chrome.storage.session，并用 alarm 心跳在重启后恢复。 */

async function getJobs() {
    const data = await chrome.storage.session.get(JOBS_KEY);
    return data[JOBS_KEY] || [];
}

async function setJobs(jobs) {
    await chrome.storage.session.set({ [JOBS_KEY]: jobs });
    if (jobs.length > 0) {
        const alarm = await chrome.alarms.get(KEEPALIVE_ALARM);
        if (!alarm) {
            await chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 0.5 });
        }
    } else {
        await chrome.alarms.clear(KEEPALIVE_ALARM);
    }
}

function arm(jobId, delayMs) {
    if (armedJobs.has(jobId)) {
        return;
    }
    armedJobs.add(jobId);
    setTimeout(function () {
        armedJobs.delete(jobId);
        fireJob(jobId).catch(function (error) {
            console.warn("[Linkclump] 队列任务失败:", error);
        });
    }, Math.max(0, delayMs));
}

async function scheduleJob(job) {
    job.id = Date.now() + "-" + Math.random().toString(36).slice(2);
    if (job.at === undefined) {
        job.at = Date.now();
    }
    const jobs = await getJobs();
    jobs.push(job);
    await setJobs(jobs);
    arm(job.id, job.at - Date.now());
    return job.id;
}

async function restoreJobs() {
    const jobs = await getJobs();
    for (const job of jobs) {
        arm(job.id, (job.at || Date.now()) - Date.now());
    }
}

async function openOne(item, job) {
    const obj = { windowId: job.windowId, url: item.url, active: false };
    if (job.openerTabId !== null && job.openerTabId !== undefined) {
        obj.openerTabId = job.openerTabId;
    }
    if (job.tabPosition !== null && job.tabPosition !== undefined) {
        obj.index = job.tabPosition;
        job.tabPosition++;
    }

    let tab;
    try {
        tab = await chrome.tabs.create(obj);
    } catch (error) {
        // opener 标签已关闭时回退
        delete obj.openerTabId;
        tab = await chrome.tabs.create(obj);
    }

    if (job.closeTime > 0 && tab && tab.id !== undefined) {
        await scheduleJob({ type: "close", tabId: tab.id, at: Date.now() + job.closeTime * 1000 });
    }
}

async function fireJob(jobId) {
    const jobs = await getJobs();
    const index = jobs.findIndex(function (job) { return job.id === jobId; });
    if (index < 0) {
        return;
    }
    const job = jobs[index];

    if (job.type === "close") {
        try {
            await chrome.tabs.remove(job.tabId);
        } catch (error) {
            // 标签可能已被用户关闭
        }
        jobs.splice(index, 1);
        await setJobs(jobs);
        return;
    }

    const item = job.urls.shift();
    if (!item) {
        jobs.splice(index, 1);
        await setJobs(jobs);
        return;
    }

    await openOne(item, job);

    if (job.urls.length > 0) {
        const wait = (Number(job.delay) || 0) * 1000;
        job.at = Date.now() + wait;
        await setJobs(jobs);
        arm(jobId, wait);
    } else {
        jobs.splice(index, 1);
        await setJobs(jobs);
    }
}

chrome.alarms.onAlarm.addListener(function (alarm) {
    if (alarm.name === KEEPALIVE_ALARM) {
        restoreJobs().catch(function (error) {
            console.warn("[Linkclump] 恢复队列失败:", error);
        });
    }
});

/* ---------- 已访问链接记录（Chrome 136+ :visited 分区兼容） ---------- */

async function getVisitedUrls() {
    const data = await chrome.storage.local.get(VISITED_KEY);
    return data[VISITED_KEY] || [];
}

async function markVisited(urls) {
    const list = await getVisitedUrls();
    const set = new Set(list);
    for (const url of urls || []) {
        if (url) {
            set.add(url);
        }
    }
    let merged = Array.from(set);
    if (merged.length > MAX_VISITED) {
        merged = merged.slice(merged.length - MAX_VISITED);
    }
    await chrome.storage.local.set({ [VISITED_KEY]: merged });
    return { ok: true, total: merged.length };
}

async function broadcast(message) {
    const tabs = await chrome.tabs.query({});
    await Promise.all(tabs.filter(function (tab) { return tab.id !== undefined; }).map(function (tab) {
        return chrome.tabs.sendMessage(tab.id, message).catch(function () { return null; });
    }));
}

/* ---------- 动作分发 ---------- */

async function activate(request, sender) {
    let urls = request.urls || [];
    const setting = request.setting || {};
    const opt = setting.options || {};

    if (opt.block) {
        urls = uniqueUrls(urls);
    }
    if (urls.length === 0) {
        return { ok: true };
    }
    if (opt.reverse) {
        urls = urls.slice().reverse();
    }

    switch (setting.action) {
    case "copy": {
        let text = "";
        const copyFormat = (opt.copy === undefined || opt.copy === null || opt.copy === "") ? 0 : opt.copy;
        for (const item of urls) {
            text += formatLink(item, copyFormat);
        }
        if (parseInt(copyFormat) === AS_LIST_LINK_HTML) {
            text = "<ul>\n" + text + "</ul>\n";
        }
        await copyToClipboard(text);
        return { ok: true };
    }
    case "bm": {
        const tree = await chrome.bookmarks.getTree();
        const root = tree[0];
        const other = root.children && (root.children[1] || root.children[0]);
        const folder = await chrome.bookmarks.create({
            parentId: other.id,
            title: "Linkclump " + timeConverter(new Date())
        });
        for (const item of urls) {
            await chrome.bookmarks.create({
                parentId: folder.id,
                title: item.title || item.url,
                url: item.url
            });
        }
        return { ok: true };
    }
    case "win": {
        const currentWindow = await chrome.windows.getCurrent();
        const first = urls.shift();
        const win = await chrome.windows.create({ url: first.url, focused: !opt.unfocus });
        if (urls.length > 0) {
            await scheduleJob({
                type: "open", urls: urls, delay: opt.delay || 0,
                windowId: win.id, openerTabId: null,
                tabPosition: null, closeTime: 0
            });
        }
        if (opt.unfocus) {
            await chrome.windows.update(currentWindow.id, { focused: true });
        }
        return { ok: true };
    }
    case "tabs": {
        const senderTabId = sender && sender.tab && sender.tab.id;
        let tabPosition = null;
        if (senderTabId !== undefined && !opt.end) {
            const tab = await chrome.tabs.get(senderTabId);
            tabPosition = tab.index + 1;
        }
        const win = await chrome.windows.getCurrent();
        await scheduleJob({
            type: "open", urls: urls, delay: opt.delay || 0,
            windowId: win.id,
            openerTabId: opt.delay ? null : senderTabId,
            tabPosition: tabPosition,
            closeTime: opt.close || 0
        });
        return { ok: true };
    }
    default:
        return { ok: false, error: "未知动作: " + setting.action };
    }
}

async function handleRequest(request, sender) {
    switch (request.message) {
    case "init":
        return await settingsManager.load();
    case "getVisited":
        return { urls: await getVisitedUrls() };
    case "markVisited":
        return await markVisited(request.urls);
    case "clearVisited":
        await chrome.storage.local.remove(VISITED_KEY);
        await broadcast({ message: "visitedCleared" });
        return { ok: true };
    case "update": {
        const settings = request.settings;
        delete settings.visitedUrls;
        await settingsManager.save(settings);
        await broadcast({ message: "update", settings: settings });
        return { ok: true };
    }
    case "activate":
        return await activate(request, sender);
    default:
        return { ok: false, error: "未知消息: " + request.message };
    }
}

chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
    if (!request || request.target === "offscreen") {
        return false;
    }
    handleRequest(request, sender).then(function (result) {
        sendResponse(result);
    }).catch(function (error) {
        console.warn("[Linkclump] 消息处理失败:", error);
        sendResponse({ ok: false, error: String(error) });
    });
    return true;
});

/* ---------- 启动 ---------- */

(async function boot() {
    try {
        if (!(await settingsManager.isInit())) {
            await settingsManager.init();

            // MV3 安装时不会向已打开的页面注入 content script
            const tabs = await chrome.tabs.query({});
            for (const tab of tabs) {
                if (!/^https?:\/\//.test(tab.url || "")) {
                    continue;
                }
                try {
                    await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ["visited.css"] });
                    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["linkclump.js"] });
                } catch (error) {
                    // 部分页面不允许注入
                }
            }

            await chrome.windows.create({
                url: chrome.runtime.getURL("pages/options.html?init=true"),
                width: 800,
                height: 850
            });
        } else if (!(await settingsManager.isLatest())) {
            await settingsManager.update();
        }
        await restoreJobs();
    } catch (error) {
        console.warn("[Linkclump] 初始化失败:", error);
    }
})();

// MV3 service worker 中没有 localStorage，设置改为 chrome.storage.local（异步）。
const CURRENT_VERSION = "6";

const DEFAULT_SETTINGS = {
    actions: {
        "101": {
            mouse: 0,      // 左键
            key: 90,       // Z 键
            action: "tabs",
            color: "#FFA500",
            options: {
                smart: 0,
                ignore: [0],
                delay: 0,
                close: 0,
                block: true,
                reverse: false,
                end: false
            }
        }
    },
    blocked: [],
    // Chrome 136+ :visited 分区兼容
    visited: {
        enabled: true,
        color: ""      // 留空 = 自动匹配站点已访问色，失败时用 Chrome 默认紫色
    }
};

function copy(value) {
    return JSON.parse(JSON.stringify(value));
}

export class SettingsManager {
    normalize(settings) {
        if (!settings.actions || Object.keys(settings.actions).length === 0) {
            settings.actions = copy(DEFAULT_SETTINGS.actions);
        }
        if (!Array.isArray(settings.blocked)) {
            settings.blocked = [];
        }
        if (!settings.visited || typeof settings.visited !== "object") {
            settings.visited = copy(DEFAULT_SETTINGS.visited);
        }
        if (typeof settings.visited.enabled !== "boolean") {
            settings.visited.enabled = true;
        }
        if (typeof settings.visited.color !== "string") {
            settings.visited.color = "";
        }
        return settings;
    }

    async load() {
        try {
            const data = await chrome.storage.local.get(["settings", "version"]);
            if (!data.settings) {
                const settings = await this.init();
                settings.error = "未找到设置，已恢复默认值";
                return settings;
            }
            return this.normalize(JSON.parse(JSON.stringify(data.settings)));
        } catch (error) {
            const settings = copy(DEFAULT_SETTINGS);
            settings.error = "读取设置失败：" + error;
            return settings;
        }
    }

    async save(settings) {
        delete settings.error;
        const clean = this.normalize(JSON.parse(JSON.stringify(settings)));
        await chrome.storage.local.set({ settings: clean, version: CURRENT_VERSION });
        return clean;
    }

    async isInit() {
        const data = await chrome.storage.local.get("version");
        return data.version !== undefined;
    }

    async isLatest() {
        const data = await chrome.storage.local.get("version");
        return data.version === CURRENT_VERSION;
    }

    async init() {
        const settings = copy(DEFAULT_SETTINGS);
        await chrome.storage.local.set({ settings: settings, version: CURRENT_VERSION });
        return settings;
    }

    async update() {
        if (!(await this.isInit())) {
            return this.init();
        }
        const settings = await this.load();
        delete settings.error;
        return this.save(settings);
    }
}

export { CURRENT_VERSION, DEFAULT_SETTINGS };

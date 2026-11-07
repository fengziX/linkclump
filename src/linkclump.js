const END_KEYCODE = 35;
const HOME_KEYCODE = 36;
const Z_INDEX = 2147483647;
const OS_WIN = 1;
const OS_LINUX = 0;
const LEFT_BUTTON = 0;
const EXCLUDE_LINKS = 0;
const INCLUDE_LINKS = 1;

var settings = null;
var setting = -1;
var key_pressed = 0;
var mouse_button = null;
var stop_menu = false;
var box_on = false;
var smart_select = false;
var mouse_x = -1;
var mouse_y = -1;
var scroll_id = 0;
var links = [];
var box = null;
var count_label = null;
var overlay = null;
var scroll_bug_ignore = false;
var os = ((navigator.appVersion.indexOf("Win") === -1) ? OS_LINUX : OS_WIN);
var timer = 0;

/* ---------- Chrome 136+ :visited 分区兼容 ----------
   分区键 = 链接 URL + 顶级站点 + 框架源。扩展用 chrome.tabs.create() 从后台打开链接，
   浏览器不认为这是"在当前页面点击了该链接"，原页面的 :visited 数据库不会写入记录，
   于是标题文字不变色。此机制无法在扩展内恢复，改为自己记录 URL 并给 <a> 加标记。 */
const VISITED_CLASS = "linkclump-visited";
const VISITED_BOX_CLASS = "linkclump-box";
// 与 Bilibili-Evolved 等重度脚本共存的关键：每次 classList.add 都是一条 attribute mutation，
// B-E 的 allMutations（document.body + attributes:true）会给每个订阅者对每条 mutation 跑一次全文档查询。
// 因此默认只标记视口内少量链接、分批摊开，且不监听 DOM；iframe 里完全不自动标记。
const IS_TOP_FRAME = (window.top === window);
const VISIBLE_MARK_LIMIT = 40;
const MARK_TOTAL_LIMIT = 120;
const MARK_BATCH_SIZE = 6;
const MARK_BATCH_DELAY = 250;
let visitedConfig = { enabled: true, color: "", auto: false };
let visitedUrls = new Set();
let visitedObserver = null;
let visitedTimer = 0;
let visitedRoots = [];
let detectedColorCache = null;

function normalizeUrl(href) {
	try {
		var url = new URL(href, window.location.href);
		if (url.protocol !== "http:" && url.protocol !== "https:") {
			return null;
		}
		url.hash = "";
		return url.href;
	} catch (error) {
		return null;
	}
}

// Chrome 136+ 会把 :visited 规则的 style.color 从 CSSOM 里隐藏（隐私缓解），
// 所以只能从原始 CSS 文本里解析站点自定义的已访问色。
//
// 这里必须用线性扫描，不能用 /([^{}]*:visited[^{}]*)\{([^{}]*)\}/ 这类正则：
// [^{}]* 在"没有 :visited 的大段文本"上会从每个起始位置反复回溯，复杂度 O(n²)。
// B 站内联样式可达几十万字符，实测旧正则单次解析把主线程占住 60 秒，load 事件被拖到 63 秒。
function parseVisitedColor(text) {
	if (!text) {
		return "";
	}
	var found = "";
	var pos = 0;
	var MAX_BODY = 4096;
	while (true) {
		var hit = text.indexOf(":visited", pos);
		if (hit === -1) {
			break;
		}
		var open = text.indexOf("{", hit);
		if (open === -1) {
			break;
		}
		// 选择器在遇到 { 之前就结束了，说明这条 :visited 后面没有规则块，跳过
		var closeBefore = text.indexOf("}", hit);
		if (closeBefore !== -1 && closeBefore < open) {
			pos = closeBefore + 1;
			continue;
		}
		var close = text.indexOf("}", open);
		if (close === -1) {
			break;
		}
		var body = text.slice(open + 1, Math.min(close, open + MAX_BODY));
		var color = /color\s*:\s*([^;!}]+)/i.exec(body);
		if (color) {
			var value = color[1].trim();
			if (value && value.indexOf("linkclump") === -1 &&
				value !== "inherit" && value !== "currentColor" && value !== "transparent") {
				found = value;
			}
		}
		pos = close + 1;
	}
	return found;
}

function detectSiteVisitedColor() {
	if (detectedColorCache !== null) {
		return detectedColorCache;
	}
	var found = "";
	var scanned = 0;
	for (var i = 0; i < document.styleSheets.length; i++) {
		var sheet = document.styleSheets[i];
		try {
			// 跳过本扩展注入的样式，避免解析到自引用的 CSS 变量
			if (sheet.href && sheet.href.indexOf("visited.css") !== -1) {
				continue;
			}
			if (sheet.ownerNode && sheet.ownerNode.tagName === "STYLE") {
				found = parseVisitedColor((sheet.ownerNode.textContent || "").slice(0, 500000)) || found;
				continue;
			}
			var rules = sheet.cssRules;
			if (!rules) {
				continue;
			}
			for (var j = 0; j < rules.length; j++) {
				// 先用 selectorText 预筛，避免对每条规则都生成 cssText
				if (!rules[j].selectorText || rules[j].selectorText.indexOf(":visited") === -1) {
					continue;
				}
				scanned++;
				if (scanned > 20000) {
					break;
				}
				if (rules[j].cssText) {
					found = parseVisitedColor(rules[j].cssText) || found;
				}
			}
		} catch (error) { /* 跨域样式表禁止读取 */ }
	}
	detectedColorCache = found;
	return found;
}

// 同源外链样式表异步补检（跨域 / CDN 样式表读不到时由用户在选项里手填颜色）。
// 限制最多 2 个、延迟到页面空闲，避免在 B 站这类多 CSS 站点重复下载/解析。
function fetchSiteVisitedColor() {
	if (!IS_TOP_FRAME || !visitedConfig.enabled || visitedConfig.color) {
		return;
	}
	var hrefs = [];
	for (var i = 0; i < document.styleSheets.length && hrefs.length < 2; i++) {
		var href = document.styleSheets[i].href;
		if (href && href.indexOf(window.location.origin) === 0) {
			hrefs.push(href);
		}
	}
	if (hrefs.length === 0) {
		return;
	}
	setTimeout(function () {
		for (var k = 0; k < hrefs.length; k++) {
			(function (target) {
				fetch(target).then(function (response) { return response.text(); }).then(function (text) {
					var color = parseVisitedColor(text.slice(0, 500000));
					if (color && !visitedConfig.color) {
						document.documentElement.style.setProperty("--linkclump-visited-color", color);
					}
				}).catch(function () { /* 忽略 */ });
			})(hrefs[k]);
		}
	}, 1500);
}

function applyVisitedColor() {
	// 子 frame 不参与取色：同一份颜色变量在顶层设一次即可，
	// 避免每个 iframe 都把样式表扫一遍（B 站框架多，扫描成本会被放大）。
	if (!IS_TOP_FRAME) {
		return;
	}
	if (!visitedConfig.enabled) {
		document.documentElement.classList.remove("linkclump-visited-on");
		return;
	}
	document.documentElement.classList.add("linkclump-visited-on");
	var custom = (visitedConfig.color || "").trim();
	var detected = custom ? "" : detectSiteVisitedColor();
	var color = custom || detected || "#551A8B";
	try {
		if (document.documentElement.style.getPropertyValue("--linkclump-visited-color") !== color) {
			document.documentElement.style.setProperty("--linkclump-visited-color", color);
		}
	} catch (error) { /* 忽略 */ }
	if (!custom && !detected) {
		fetchSiteVisitedColor();
	}
}

function markElementTree(root) {
	if (!visitedConfig.enabled || visitedUrls.size === 0 || !root || !root.querySelectorAll) {
		return;
	}
	var anchors = root.querySelectorAll("a[href]");
	for (var i = 0; i < anchors.length; i++) {
		var key = normalizeUrl(anchors[i].href);
		if (key && visitedUrls.has(key)) {
			anchors[i].classList.add(VISITED_CLASS);
		}
	}
	if (root.nodeType === 1 && root.tagName === "A" &&
		visitedUrls.has(normalizeUrl(root.href))) {
		root.classList.add(VISITED_CLASS);
	}
}

// 分批加 class：避免一次几百条 attribute mutation 把 B-E 的 allMutations 订阅者打爆
function markInBatches(elements) {
	if (!elements || elements.length === 0) {
		return;
	}
	var index = 0;
	function step() {
		var end = Math.min(index + MARK_BATCH_SIZE, elements.length);
		for (; index < end; index++) {
			if (elements[index].isConnected) {
				elements[index].classList.add(VISITED_CLASS);
			}
		}
		if (index < elements.length) {
			setTimeout(step, MARK_BATCH_DELAY);
		}
	}
	setTimeout(step, 250);
}

// 只标记视口附近的链接，最多 80 个；不遍历全页、不监听 DOM
function markVisibleLinks() {
	if (!IS_TOP_FRAME || !visitedConfig.enabled || visitedUrls.size === 0) {
		return;
	}
	var links = Array.from(document.links);
	var matched = [];
	var top = -200;
	var bottom = window.innerHeight + 200;
	for (var i = 0; i < links.length && matched.length < VISIBLE_MARK_LIMIT; i++) {
		var link = links[i];
		if (link.classList.contains(VISITED_CLASS)) {
			continue;
		}
		var key = normalizeUrl(link.href);
		if (!key || !visitedUrls.has(key)) {
			continue;
		}
		var rect = link.getBoundingClientRect();
		if (rect.bottom < top || rect.top > bottom) {
			continue;
		}
		matched.push(link);
	}
	markInBatches(matched);
}

function markVisitedNow(urls) {
	if (!visitedConfig.enabled) {
		return;
	}
	var keys = [];
	for (var i = 0; i < urls.length; i++) {
		var key = normalizeUrl(urls[i]);
		if (key) {
			visitedUrls.add(key);
			keys.push(key);
		}
	}
	if (keys.length === 0) {
		return;
	}
	var wanted = new Set(keys);
	var links = Array.from(document.links);
	var matched = [];
	for (var j = 0; j < links.length && matched.length < MARK_TOTAL_LIMIT; j++) {
		var linkKey = normalizeUrl(links[j].href);
		if (linkKey && wanted.has(linkKey) && !links[j].classList.contains(VISITED_CLASS)) {
			matched.push(links[j]);
		}
	}
	markInBatches(matched);
	chrome.runtime.sendMessage({ message: "markVisited", urls: keys }).catch(function () { /* 忽略 */ });
}

function clearVisitedNow() {
	visitedUrls.clear();
	var marked = Array.from(document.querySelectorAll("." + VISITED_CLASS));
	for (var i = 0; i < marked.length; i++) {
		marked[i].classList.remove(VISITED_CLASS);
	}
}

function startVisitedObserver() {
	// 默认不监听 DOM：B-E 等脚本每次重渲染都会产生大量新增节点，
	// 若这里跟着标记，会形成「它渲染 → 我们标记 → 它的 allMutations 收到 class mutation」的持续放大。
	if (!IS_TOP_FRAME || !visitedConfig.auto || !visitedConfig.enabled) {
		return;
	}
	if (visitedObserver) {
		return;
	}
	visitedObserver = new MutationObserver(function (mutations) {
		if (!visitedConfig.enabled || visitedUrls.size === 0) {
			return;
		}
		for (var i = 0; i < mutations.length; i++) {
			var nodes = mutations[i].addedNodes;
			for (var j = 0; j < nodes.length; j++) {
				var node = nodes[j];
				if (node.nodeType === 1 && !(node.classList && node.classList.contains(VISITED_BOX_CLASS))) {
					visitedRoots.push(node);
				}
			}
		}
		if (visitedRoots.length === 0) {
			return;
		}
		clearTimeout(visitedTimer);
		visitedTimer = setTimeout(function () {
			var roots = visitedRoots.splice(0);
			for (var k = 0; k < roots.length; k++) {
				markElementTree(roots[k]);
			}
		}, 150);
	});
	try {
		visitedObserver.observe(document.documentElement, { childList: true, subtree: true });
	} catch (error) { /* 忽略 */ }
}

Promise.all([
	chrome.runtime.sendMessage({ message: "init" }),
	// iframe 里不拉取整份已访问列表，避免每个 frame 都传几百 KB
	IS_TOP_FRAME ? chrome.runtime.sendMessage({ message: "getVisited" }) : Promise.resolve({ urls: [] })
]).then(function (responses) {
	var response = responses[0];
	var visitedResponse = responses[1] || { urls: [] };
	if (!response) {
		console.log("[Linkclump] 设置加载失败：后台未返回数据");
		return;
	}
	if (response.hasOwnProperty("error")) {
		console.log("[Linkclump] 设置读取异常，已使用默认值：" + response.error);
	}

	settings = response.actions;
	visitedConfig = response.visited || { enabled: true, color: "", auto: false };
	if (typeof visitedConfig.auto !== "boolean") {
		visitedConfig.auto = false;
	}
	visitedUrls = new Set(IS_TOP_FRAME ? (visitedResponse.urls || []) : []);

	applyVisitedColor();
	markVisibleLinks();
	startVisitedObserver();

	var allowed = true;
	for (var i in (response.blocked || [])) {
		if (response.blocked[i] == "") continue;
		var re = new RegExp(response.blocked[i], "i");

		if (re.test(window.location.href)) {
			allowed = false;
			console.log("[Linkclump] 此站点已被黑名单屏蔽：" + response.blocked[i] + " ~ " + window.location.href);
		}
	}

	if (allowed) {
		window.addEventListener("mousedown", mousedown, true);
		window.addEventListener("keydown", keydown, true);
		window.addEventListener("keyup", keyup, true);
		window.addEventListener("blur", blur, true);
		window.addEventListener("contextmenu", contextmenu, true);
	}
}).catch(function (error) {
	console.log("[Linkclump] 初始化失败：" + error);
});

chrome.runtime.onMessage.addListener(function (request) {
	if (request.message === "update") {
		settings = request.settings.actions;
		visitedConfig = request.settings.visited || visitedConfig;
		if (typeof visitedConfig.auto !== "boolean") {
			visitedConfig.auto = false;
		}
		if (!visitedConfig.auto && visitedObserver) {
			visitedObserver.disconnect();
			visitedObserver = null;
		}
		applyVisitedColor();
		markVisibleLinks();
		startVisitedObserver();
	} else if (request.message === "visitedCleared") {
		clearVisitedNow();
	}
});

function mousemove(event) {
	this.prevent_escalation(event);

	if (this.allow_selection() || this.scroll_bug_ignore) {
		this.scroll_bug_ignore = false;
		this.update_box(event.pageX, event.pageY);

		// while detect keeps on calling false then recall the method
		while (!this.detech(event.pageX, event.pageY, false)) {
			// empty
		}
	} else {
		// only stop if the mouseup timer is no longer set
		if (this.timer === 0) {
			this.stop();
		}
	}
}

function clean_up() {
	// remove the box
	box.style.visibility = "hidden";
	count_label.style.visibility = "hidden";
	box_on = false;

	// remove the link boxes
	for (var i = 0; i < this.links.length; i++) {
		if (this.links[i].box !== null) {
			document.body.removeChild(this.links[i].box);
			this.links[i].box = null;
		}
	}
	this.links = [];

	// wipe clean the smart select
	this.smart_select = false;
	this.mouse_button = -1;
	this.key_pressed = 0;
}

function mousedown(event) {
	mouse_button = event.button;

	// turn on menu for windows
	if (os === OS_WIN) {
		stop_menu = false;
	}

	if (allow_selection()) {
		// don't prevent for windows right click as it breaks spell checker
		// do prevent for left as otherwise the page becomes highlighted
		if (os === OS_LINUX || (os === OS_WIN && mouse_button === LEFT_BUTTON)) {
			prevent_escalation(event);
		}

		// if mouse up timer is set then clear it as it was just caused by bounce
		if (timer !== 0) {
			//console.log("bounced!");
			clearTimeout(timer);
			timer = 0;

			// keep menu off for windows
			if (os === OS_WIN) {
				stop_menu = true;
			}
		} else {
			// clean up any mistakes
			if (box_on) {
				console.log("box wasn't removed from previous operation");
				clean_up();
			}

			// create the box
		if (this.box === null) {
			this.box = document.createElement("span");
			this.box.className = VISITED_BOX_CLASS;
			this.box.style.margin = "0px auto";
			this.box.style.border = "2px dotted " + this.settings[this.setting].color;
			this.box.style.position = "absolute";
			this.box.style.zIndex = Z_INDEX;
			this.box.style.visibility = "hidden";

			count_label = document.createElement("span");
			count_label.className = VISITED_BOX_CLASS;
			count_label.style.zIndex = Z_INDEX;
				count_label.style.position = "absolute";
				count_label.style.visibility = "hidden";
				count_label.style.left = "10px";
				count_label.style.width = "50px";
				count_label.style.top = "10px";
				count_label.style.height = "20px";
				count_label.style.fontSize = "10px";
				count_label.style.font = "Arial, sans-serif";
				count_label.style.color = "black";

				document.body.appendChild(box);
				document.body.appendChild(count_label);

			}

			// update position
			this.box.x = event.pageX;
			this.box.y = event.pageY;
			this.update_box(event.pageX, event.pageY);

			// setup mouse move and mouse up
			window.addEventListener("mousemove", mousemove, true);
			window.addEventListener("mouseup", mouseup, true);
			window.addEventListener("mousewheel", mousewheel, true);
			window.addEventListener("wheel", mousewheel, true);
			window.addEventListener("mouseout", mouseout, true);
		}
	}
}

function update_box(x, y) {
	var width = Math.max(document.documentElement["clientWidth"], document.body["scrollWidth"], document.documentElement["scrollWidth"], document.body["offsetWidth"], document.documentElement["offsetWidth"]); // taken from jquery
	var height = Math.max(document.documentElement["clientHeight"], document.body["scrollHeight"], document.documentElement["scrollHeight"], document.body["offsetHeight"], document.documentElement["offsetHeight"]); // taken from jquery
	x = Math.min(x, width - 7);
	y = Math.min(y, height - 7);

	if (x > this.box.x) {
		this.box.x1 = this.box.x;
		this.box.x2 = x;
	} else {
		this.box.x1 = x;
		this.box.x2 = this.box.x;
	}
	if (y > this.box.y) {
		this.box.y1 = this.box.y;
		this.box.y2 = y;
	} else {
		this.box.y1 = y;
		this.box.y2 = this.box.y;
	}

	this.box.style.left = this.box.x1 + "px";
	this.box.style.width = this.box.x2 - this.box.x1 + "px";
	this.box.style.top = this.box.y1 + "px";
	this.box.style.height = this.box.y2 - this.box.y1 + "px";

	count_label.style.left = x - 15 + "px";
	count_label.style.top = y - 15 + "px";
}

function mousewheel() {
	this.scroll_bug_ignore = true;
}

function mouseout(event) {
	this.mousemove(event);
	// the mouse wheel event might also call this event
	this.scroll_bug_ignore = true;
}

function prevent_escalation(event) {
	event.stopPropagation();
	event.preventDefault();
}

function mouseup(event) {
	this.prevent_escalation(event);

	if (this.box_on) {
		// all the detection of the mouse to bounce
		if (this.allow_selection() && this.timer === 0) {
			this.timer = setTimeout(function() {
				this.update_box(event.pageX, event.pageY);
				this.detech(event.pageX, event.pageY, true);

				this.stop();
				this.timer = 0;
			}, 100);
		}
	} else {
		// false alarm
		this.stop();
	}
}

// 旧的 WebKitCSSMatrix + offsetParent 累加在 Chrome 150+ 上对 transform / 滚动容器
// 会算错，且 webkitTransform 为 "none" 时会直接抛异常导致整个框选失效。
function getXY(element) {
	var rect = element.getBoundingClientRect();
	return {
		x: rect.left + window.scrollX,
		y: rect.top + window.scrollY
	};
}

function start() {
	// 阻止页面文字被框选（khtmlUserSelect 在新版 Chrome 已失效）
	document.body.style.userSelect = "none";
	document.body.style.webkitUserSelect = "none";
	document.body.style.khtmlUserSelect = "none";

	// turn on the box
	this.box.style.visibility = "visible";
	this.count_label.style.visibility = "visible";

	// find all links (find them each time as they could have moved)
	var page_links = document.links;

	// create RegExp once
	var re1 = new RegExp("^javascript:", "i");
	var re2 = new RegExp(this.settings[this.setting].options.ignore.slice(1).join("|"), "i");
	var re3 = new RegExp("^H\\d$");

	for (var i = 0; i < page_links.length; i++) {
		// reject javascript: links
		if (re1.test(page_links[i].href)) {
			continue;
		}

		// reject href="" or href="#"
		if (!page_links[i].getAttribute("href") || page_links[i].getAttribute("href") === "#") {
			continue;
		}

		// include/exclude links
		if (this.settings[this.setting].options.ignore.length > 1) {
			if (re2.test(page_links[i].href) || re2.test(page_links[i].innerHTML)) {
				if (this.settings[this.setting].options.ignore[0] == EXCLUDE_LINKS) {
					continue;
				}
			} else if (this.settings[this.setting].options.ignore[0] == INCLUDE_LINKS) {
				continue;
			}
		}

		// attempt to ignore invisible links (can't ignore overflow)
		var comp = window.getComputedStyle(page_links[i], null);
		if (comp.visibility == "hidden" || comp.display == "none") {
			continue;
		}

		var pos = this.getXY(page_links[i]);
		var width = page_links[i].offsetWidth;
		var height = page_links[i].offsetHeight;

		// attempt to get the actual size of the link
		for (var k = 0; k < page_links[i].childNodes.length; k++) {
			if (page_links[i].childNodes[k].nodeName == "IMG") {
				const pos2 = this.getXY(page_links[i].childNodes[k]);
				if (pos.y >= pos2.y) {
					pos.y = pos2.y;

					width = Math.max(width, page_links[i].childNodes[k].offsetWidth);
					height = Math.max(height, page_links[i].childNodes[k].offsetHeight);
				}
			}
		}

		page_links[i].x1 = pos.x;
		page_links[i].y1 = pos.y;
		page_links[i].x2 = pos.x + width;
		page_links[i].y2 = pos.y + height;
		page_links[i].height = height;
		page_links[i].width = width;
		page_links[i].box = null;
		page_links[i].important = this.settings[this.setting].options.smart == 0 && page_links[i].parentNode != null && re3.test(page_links[i].parentNode.nodeName);

		this.links.push(page_links[i]);
	}

	this.box_on = true;

	// turn off menu for windows so mouse up doesn't trigger context menu
	if (os === OS_WIN) {
		this.stop_menu = true;
	}
}

function stop() {
	// 恢复页面文字选择
	document.body.style.userSelect = "";
	document.body.style.webkitUserSelect = "";
	document.body.style.khtmlUserSelect = "";

	// 关闭鼠标监听
	window.removeEventListener("mousemove", mousemove, true);
	window.removeEventListener("mouseup", mouseup, true);
	window.removeEventListener("mousewheel", mousewheel, true);
	window.removeEventListener("wheel", mousewheel, true);
	window.removeEventListener("mouseout", mouseout, true);

	if (this.box_on) {
		this.clean_up();
	}

	// turn on menu for linux
	if (os === OS_LINUX && this.settings[this.setting].key != this.key_pressed) {
		this.stop_menu == false;
	}
}

function scroll() {
	if (this.allow_selection()) {
		var y = this.mouse_y - window.scrollY;
		var win_height = window.innerHeight;

		if (y > win_height - 20) { //down
			let speed = win_height - y;
			if (speed < 2) {
				speed = 60;
			} else if (speed < 10) {
				speed = 30;
			} else {
				speed = 10;
			}
			window.scrollBy(0, speed);
			this.mouse_y += speed;
			this.update_box(this.mouse_x, this.mouse_y);
			this.detech(this.mouse_x, this.mouse_y, false);

			this.scroll_bug_ignore = true;
			return;
		} else if (window.scrollY > 0 && y < 20) { //up
			let speed = y;
			if (speed < 2) {
				speed = 60;
			} else if (speed < 10) {
				speed = 30;
			} else {
				speed = 10;
			}
			window.scrollBy(0, -speed);
			this.mouse_y -= speed;
			this.update_box(this.mouse_x, this.mouse_y);
			this.detech(this.mouse_x, this.mouse_y, false);

			this.scroll_bug_ignore = true;
			return;
		}
	}

	clearInterval(this.scroll_id);
	this.scroll_id = 0;
}


function detech(x, y, open) {
	this.mouse_x = x;
	this.mouse_y = y;

	if (!this.box_on) {
		if (this.box.x2 - this.box.x1 < 5 && this.box.y2 - this.box.y1 < 5) {
			return true;
		} else {
			this.start();
		}

	}

	if (!this.scroll_id) {
		this.scroll_id = setInterval(scroll, 100);
	}

	var count = 0;
	var count_tabs = new Set;
	var open_tabs = [];
	for (var i = 0; i < this.links.length; i++) {
		if ((!this.smart_select || this.links[i].important) && !(this.links[i].x1 > this.box.x2 || this.links[i].x2 < this.box.x1 || this.links[i].y1 > this.box.y2 || this.links[i].y2 < this.box.y1)) {
			if (open) {
				open_tabs.push({
					"url": this.links[i].href,
					"title": this.links[i].innerText
				});
			}

			// check if important links have been selected and possibly redo
			if (!this.smart_select) {
				if (this.links[i].important) {
					this.smart_select = true;
					return false;
				}
			} else {
				if (this.links[i].important) {
					count++;
				}
			}

			if (this.links[i].box === null) {
			var link_box = document.createElement("span");
			link_box.className = VISITED_BOX_CLASS;
			link_box.style.margin = "0px auto";
				link_box.style.border = "1px solid red";
				link_box.style.position = "absolute";
				link_box.style.width = this.links[i].width + "px";
				link_box.style.height = this.links[i].height + "px";
				link_box.style.top = this.links[i].y1 + "px";
				link_box.style.left = this.links[i].x1 + "px";
				link_box.style.zIndex = Z_INDEX;

				document.body.appendChild(link_box);
				this.links[i].box = link_box;
			} else {
				this.links[i].box.style.visibility = "visible";
			}

			count_tabs.add(this.links[i].href);
		} else {
			if (this.links[i].box !== null) {
				this.links[i].box.style.visibility = "hidden";
			}
		}
	}

	// important links were found, but not anymore so redo
	if (this.smart_select && count === 0) {
		this.smart_select = false;
		return false;
	}

	count_label.innerText = count_tabs.size;

	if (open_tabs.length > 0) {
		chrome.runtime.sendMessage({
			message: "activate",
			urls: open_tabs,
			setting: this.settings[this.setting]
		}).catch(function (error) {
			console.log("[Linkclump] 打开链接失败：" + error);
		});

		// 只有真正访问过的动作才标记；复制 / 加书签不算访问
		var action = this.settings[this.setting].action;
		if (action === "tabs" || action === "win") {
			markVisitedNow(open_tabs.map(function (item) { return item.url; }));
		}
	}

	return true;
}

function allow_key(keyCode) {
	for (var i in this.settings) {
		if (this.settings[i].key == keyCode) {
			return true;
		}
	}
	return false;
}


function keydown(event) {
	if (event.keyCode != END_KEYCODE && event.keyCode != HOME_KEYCODE) {
		this.key_pressed = event.keyCode;
		// turn menu off for linux
		if (os === OS_LINUX && this.allow_key(this.key_pressed)) {
			this.stop_menu = true;
		}
	} else {
		this.scroll_bug_ignore = true;
	}
}

function blur() {
	remove_key();
}

function keyup(event) {
	if (event.keyCode != END_KEYCODE && event.keyCode != HOME_KEYCODE) {
		remove_key();
	}
}

function remove_key() {
	// turn menu on for linux
	if (os === OS_LINUX) {
		this.stop_menu = false;
	}
	this.key_pressed = 0;
}


function allow_selection() {
	for (var i in this.settings) {
		// need to check if key is 0 as key_pressed might not be accurate
		if (this.settings[i].mouse == this.mouse_button && this.settings[i].key == this.key_pressed) {
			this.setting = i;
			if (this.box !== null) {
				this.box.style.border = "2px dotted " + this.settings[i].color;
			}
			return true;
		}
	}
	return false;
}

function contextmenu(event) {
	if (this.stop_menu) {
		event.preventDefault();
	}
}

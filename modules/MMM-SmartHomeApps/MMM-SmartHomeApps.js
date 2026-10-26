/* MMM-SmartHomeApps - the app rail
 * Widescreen tiles in a horizontal rail with faded edges. Navigate with
 * ←/→, open with Enter, return with Esc/Back. Apps come from
 * config/smarthome.json (via MMM-SmartHome); locked apps ask the shell for the PIN.
 *
 * Streaming sites play inside a full-window <webview> (castLabs Electron for DRM).
 */
Module.register("MMM-SmartHomeApps", {
	defaults: {
		mode: "embedded", // or "external" to launch a real browser
		partition: "persist:smarthome-apps",
		browser: "Google Chrome",
		kiosk: true,
		backButtonTimeout: 3000,
		tileWidth: 320,
		apps: []
	},

	getStyles () {
		return ["MMM-SmartHomeApps.css"];
	},

	start () {
		this.apps = this.config.apps || [];
		this.selected = 0;
		this.overlay = null;
		this.pendingOpen = null;
		this.status = null;
		document.addEventListener("keydown", (e) => this.onKey(e));
	},

	visibleApps () {
		return this.apps.filter((a) => !a.hidden);
	},

	/* ---------- notifications ---------- */

	notificationReceived (notification, payload) {
		if (notification === "SH_STATE" && payload && Array.isArray(payload.apps)) {
			this.apps = payload.apps;
			this.selected = Math.min(this.selected, Math.max(0, this.visibleApps().length - 1));
			this.updateDom(0);
		} else if (notification === "SH_PIN_GRANTED" && this.pendingOpen && payload.token === this.pendingOpen.token) {
			const app = this.pendingOpen.app;
			this.pendingOpen = null;
			this.openApp(app);
		} else if (notification === "SH_FOCUS_RAIL") {
			this.updateDom(0);
		} else if (notification === "SH_OPEN_URL" && payload && payload.url) {
			this.openApp({ name: payload.title ? `${payload.title} on ${payload.name}` : payload.name, url: payload.url });
		}
	},

	socketNotificationReceived (notification, payload) {
		if (notification === "SMARTHOME_OPEN_APP_RESULT") {
			this.status = payload.ok ? null : `Couldn't open ${payload.name}: ${payload.error}`;
			this.updateDom(0);
		}
	},

	/* ---------- rail ---------- */

	getDom () {
		const wrapper = document.createElement("div");
		wrapper.className = "sh-rail-wrap";
		const rail = document.createElement("div");
		rail.className = "sh-rail";
		wrapper.appendChild(rail);

		const apps = this.visibleApps();
		if (!apps.length) {
			const empty = document.createElement("div");
			empty.className = "dimmed small";
			empty.textContent = "No apps - add some in Settings";
			wrapper.appendChild(empty);
			return wrapper;
		}

		apps.forEach((app, i) => {
			const tile = document.createElement("div");
			tile.className = `sh-tile${i === this.selected ? " selected" : ""}${app.locked ? " locked" : ""}`;
			tile.style.setProperty("--tile-color", app.color || "#333");
			tile.style.width = `${this.config.tileWidth}px`;
			tile.tabIndex = -1;

			const foot = document.createElement("div");
			foot.className = "sh-tile-foot";
			const icon = document.createElement("img");
			icon.className = "sh-tile-icon";
			icon.alt = "";
			icon.src = app.icon || this.faviconFor(app.url);
			icon.addEventListener("error", () => icon.remove());
			const name = document.createElement("span");
			name.className = "sh-tile-name";
			name.textContent = app.name;
			foot.append(icon, name);
			tile.appendChild(foot);

			if (app.locked) {
				const badge = document.createElement("span");
				badge.className = "sh-tile-badge";
				badge.textContent = "🔒";
				tile.appendChild(badge);
			}

			tile.addEventListener("mouseenter", () => this.select(i, false));
			tile.addEventListener("click", () => this.activate(app));
			rail.appendChild(tile);
		});

		if (this.status) {
			const note = document.createElement("div");
			note.className = "dimmed xsmall sh-rail-status";
			note.textContent = this.status;
			wrapper.appendChild(note);
		}

		requestAnimationFrame(() => this.scrollToSelected(rail, false));
		return wrapper;
	},

	faviconFor (url) {
		try {
			return `https://www.google.com/s2/favicons?domain=${new URL(url).hostname}&sz=128`;
		} catch {
			return "";
		}
	},

	select (index, scroll = true) {
		const apps = this.visibleApps();
		if (!apps.length) return;
		this.selected = Math.max(0, Math.min(apps.length - 1, index));
		const rail = document.querySelector(`#${this.identifier} .sh-rail`);
		if (!rail) return;
		[...rail.children].forEach((t, i) => t.classList.toggle("selected", i === this.selected));
		if (scroll) this.scrollToSelected(rail, true);
	},

	scrollToSelected (rail, smooth) {
		const tile = rail.children[this.selected];
		if (tile) tile.scrollIntoView({ inline: "center", block: "nearest", behavior: smooth ? "smooth" : "auto" });
	},

	activate (app) {
		if (app.locked) {
			const token = `${Date.now()}`;
			this.pendingOpen = { app, token };
			this.sendNotification("SH_REQUEST_PIN", { title: `PIN required for ${app.name}`, token });
			return;
		}
		this.openApp(app);
	},

	/* ---------- remote / keyboard ---------- */

	shellBusy () {
		return document.body.classList.contains("sh-pin-open") || document.body.classList.contains("sh-panel-open");
	},

	onKey (event) {
		if (this.shellBusy()) return;

		if (this.overlay) {
			if (["Escape", "BrowserBack", "Backspace", "BrowserHome", "Home"].includes(event.key)) {
				event.preventDefault();
				this.closeEmbedded();
			}
			return;
		}

		const apps = this.visibleApps();
		if (!apps.length || this.hidden) return;
		switch (event.key) {
			case "ArrowRight": this.select(this.selected + 1); break;
			case "ArrowLeft": this.select(this.selected - 1); break;
			case "ArrowUp": this.sendNotification("SH_FOCUS_UP"); break;
			case "Enter": if (document.activeElement === document.body || !document.activeElement) this.activate(apps[this.selected]); else return; break;
			default: return;
		}
		event.preventDefault();
	},

	/* ---------- opening apps ---------- */

	openApp (app) {
		const webviewAvailable = typeof document.createElement("webview").getWebContentsId === "function";
		if (this.config.mode === "external" || !webviewAvailable) {
			this.sendSocketNotification("SMARTHOME_OPEN_APP", { name: app.name, url: app.url, browser: this.config.browser, kiosk: this.config.kiosk });
			return;
		}
		this.showEmbedded(app);
	},

	chromeUserAgent () {
		return navigator.userAgent.replace(/\s?(Electron|MagicMirror)\/[\d.]+/gi, "");
	},

	showEmbedded (app) {
		this.closeEmbedded();
		const overlay = document.createElement("div");
		overlay.className = "smarthome-overlay";

		const loading = document.createElement("div");
		loading.className = "smarthome-overlay-loading";
		loading.textContent = `Loading ${app.name}…`;
		overlay.appendChild(loading);

		const view = document.createElement("webview");
		view.className = "smarthome-webview";
		view.setAttribute("partition", this.config.partition);
		view.setAttribute("useragent", this.chromeUserAgent());
		view.setAttribute("allowfullscreen", "");
		view.setAttribute("src", app.url);
		overlay.appendChild(view);

		const back = document.createElement("button");
		back.className = "smarthome-overlay-back";
		back.type = "button";
		back.innerHTML = "&larr; Dashboard";
		back.addEventListener("click", () => this.closeEmbedded());
		overlay.appendChild(back);

		view.addEventListener("did-finish-load", () => { loading.remove(); view.focus(); });
		view.addEventListener("did-fail-load", (event) => {
			if (event.errorCode === -3) return;
			loading.textContent = `Couldn't load ${app.name} (${event.errorDescription || event.errorCode})`;
		});
		view.addEventListener("enter-html-full-screen", () => overlay.classList.add("video-fullscreen"));
		view.addEventListener("leave-html-full-screen", () => overlay.classList.remove("video-fullscreen"));

		// Keys pressed inside the guest never reach us, so the guest reports
		// Back/Home via console.log, and handles play/pause for the remote.
		view.addEventListener("dom-ready", () => {
			view.executeJavaScript(`
				if (!window.__smarthomeHook) {
					window.__smarthomeHook = true;
					document.addEventListener("keydown", (e) => {
						if ((e.key === "Escape" || e.key === "BrowserBack") && !document.fullscreenElement) console.log("__SMARTHOME_BACK__");
						if (e.key === "BrowserHome" || e.key === "Home") console.log("__SMARTHOME_BACK__");
						if (e.key === "MediaPlayPause" || e.key === "MediaPlay" || e.key === "MediaPause") {
							const v = document.querySelector("video");
							if (v) { v.paused ? v.play() : v.pause(); e.preventDefault(); }
						}
					}, true);
				}
			`).catch(() => {});
		});
		view.addEventListener("console-message", (event) => {
			if (event.message === "__SMARTHOME_BACK__") this.closeEmbedded();
		});

		let hideTimer = null;
		const reveal = () => {
			back.classList.add("visible");
			clearTimeout(hideTimer);
			hideTimer = setTimeout(() => back.classList.remove("visible"), this.config.backButtonTimeout);
		};
		overlay.addEventListener("mousemove", reveal);
		reveal();

		document.body.appendChild(overlay);
		document.body.classList.add("sh-overlay-open");
		this.overlay = overlay;
		this.sendNotification("SMARTHOME_APP_OPENED", { name: app.name });
	},

	closeEmbedded () {
		if (!this.overlay) return;
		this.overlay.remove();
		this.overlay = null;
		document.body.classList.remove("sh-overlay-open");
		if (document.activeElement) document.activeElement.blur();
		this.sendNotification("SMARTHOME_APP_CLOSED");
	}
});

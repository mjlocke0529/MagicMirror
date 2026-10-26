/* MMM-SmartHomeApps
 * App launcher for the SmartHome dashboard.
 *
 * mode: "embedded" (default) - opens the app in a full-window <webview> inside
 *        MagicMirror. Needs the castLabs Electron build (Widevine) for DRM
 *        services like Netflix / Disney+, and webviewTag enabled in electron.js.
 * mode: "external" - launches the URL in a real browser via node_helper.
 */
Module.register("MMM-SmartHomeApps", {
	defaults: {
		mode: "embedded",
		partition: "persist:smarthome-apps", // shared cookie jar so logins persist across restarts
		browser: "Google Chrome", // external mode only
		kiosk: true, // external mode only
		backButtonTimeout: 3000, // ms the "Back" button stays visible after the mouse moves
		apps: [
			{ name: "Netflix", url: "https://www.netflix.com/browse", color: "#e50914" },
			{ name: "Disney+", url: "https://www.disneyplus.com/home", color: "#0f3fa3" }
		]
	},

	getStyles () {
		return ["MMM-SmartHomeApps.css"];
	},

	start () {
		this.status = null;
		this.overlay = null;
		this.boundKeyHandler = (event) => this.onHostKey(event);
		document.addEventListener("keydown", this.boundKeyHandler);
	},

	/* ---------- tiles ---------- */

	getDom () {
		const wrapper = document.createElement("div");
		wrapper.className = "smarthome-apps";

		this.config.apps.forEach((app) => {
			const tile = document.createElement("button");
			tile.className = "smarthome-app-tile";
			tile.type = "button";
			tile.style.setProperty("--tile-color", app.color || "#333");

			const label = document.createElement("span");
			label.className = "smarthome-app-label";
			label.textContent = app.name;
			tile.appendChild(label);

			tile.addEventListener("click", () => this.openApp(app, tile));
			wrapper.appendChild(tile);
		});

		if (this.status) {
			const note = document.createElement("div");
			note.className = "smarthome-apps-status dimmed xsmall";
			note.textContent = this.status;
			wrapper.appendChild(note);
		}

		return wrapper;
	},

	openApp (app, tile) {
		tile.classList.add("launching");
		setTimeout(() => tile.classList.remove("launching"), 1500);

		if (this.config.mode === "external" || typeof document.createElement("webview").getWebContentsId !== "function") {
			if (this.config.mode !== "external") {
				Log.warn(`${this.name}: <webview> not available (webviewTag off?), falling back to external browser`);
			}
			this.sendSocketNotification("SMARTHOME_OPEN_APP", {
				name: app.name,
				url: app.url,
				browser: this.config.browser,
				kiosk: this.config.kiosk
			});
			return;
		}

		this.showEmbedded(app);
	},

	/* ---------- embedded overlay ---------- */

	// Streaming sites refuse unknown browsers; present as plain Chrome.
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

		view.addEventListener("did-finish-load", () => loading.remove());
		view.addEventListener("did-fail-load", (event) => {
			if (event.errorCode === -3) return; // aborted (redirect), not a real failure
			loading.textContent = `Couldn't load ${app.name} (${event.errorDescription || event.errorCode})`;
		});
		view.addEventListener("enter-html-full-screen", () => overlay.classList.add("video-fullscreen"));
		view.addEventListener("leave-html-full-screen", () => overlay.classList.remove("video-fullscreen"));

		// Keys pressed inside the guest page never reach this document, so the guest
		// reports Escape via console.log and we pick it up here. Escape while a video is
		// fullscreen just exits fullscreen (handled by the site); a second Escape returns home.
		view.addEventListener("dom-ready", () => {
			view.executeJavaScript(`
				if (!window.__smarthomeHook) {
					window.__smarthomeHook = true;
					document.addEventListener("keydown", (e) => {
						if (e.key === "Escape" && !document.fullscreenElement) console.log("__SMARTHOME_BACK__");
					}, true);
				}
			`).catch(() => {});
		});
		view.addEventListener("console-message", (event) => {
			if (event.message === "__SMARTHOME_BACK__") this.closeEmbedded();
		});

		// Show the back button briefly whenever the mouse moves over the host.
		let hideTimer = null;
		const reveal = () => {
			back.classList.add("visible");
			clearTimeout(hideTimer);
			hideTimer = setTimeout(() => back.classList.remove("visible"), this.config.backButtonTimeout);
		};
		overlay.addEventListener("mousemove", reveal);
		reveal();

		document.body.appendChild(overlay);
		this.overlay = overlay;
		this.sendNotification("SMARTHOME_APP_OPENED", { name: app.name });
	},

	closeEmbedded () {
		if (!this.overlay) return;
		this.overlay.remove();
		this.overlay = null;
		this.sendNotification("SMARTHOME_APP_CLOSED");
	},

	onHostKey (event) {
		if (this.overlay && (event.key === "Escape" || event.key === "Backspace")) {
			event.preventDefault();
			this.closeEmbedded();
		}
	},

	/* ---------- external mode results ---------- */

	socketNotificationReceived (notification, payload) {
		if (notification === "SMARTHOME_OPEN_APP_RESULT") {
			this.status = payload.ok ? null : `Couldn't open ${payload.name}: ${payload.error}`;
			this.updateDom(0);
			if (payload.ok) {
				setTimeout(() => { this.status = null; this.updateDom(0); }, 5000);
			}
		}
	}
});

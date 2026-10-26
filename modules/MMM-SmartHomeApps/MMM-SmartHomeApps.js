/* MMM-SmartHomeApps
 * App launcher for the SmartHome dashboard, with PIN-protected admin mode
 * (parental controls: hide apps, lock apps behind the PIN, add/remove apps).
 *
 * mode: "embedded" (default) - opens the app in a full-window <webview> inside
 *        MagicMirror. Needs the castLabs Electron build (Widevine) for DRM
 *        services like Netflix / Disney+, and webviewTag enabled in electron.js.
 * mode: "external" - launches the URL in a real browser via node_helper.
 */
Module.register("MMM-SmartHomeApps", {
	defaults: {
		mode: "embedded",
		adminPin: "0000", // change this in config.js!
		adminTimeout: 2 * 60 * 1000, // leave admin mode after 2 minutes
		partition: "persist:smarthome-apps",
		browser: "Google Chrome", // external mode only
		kiosk: true, // external mode only
		backButtonTimeout: 3000,
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
		this.pinDialog = null;
		this.state = { overrides: {}, customApps: [] };
		this.admin = false;
		this.adminPinCache = null;
		this.adminTimer = null;
		this.showAddForm = false;
		document.addEventListener("keydown", (event) => this.onHostKey(event));
		this.sendSocketNotification("SMARTHOME_INIT", { adminPin: String(this.config.adminPin) });
	},

	/* ---------- app list ---------- */

	allApps () {
		const custom = (this.state.customApps || []).map((app) => ({ ...app, custom: true }));
		return [...this.config.apps, ...custom].map((app) => {
			const o = this.state.overrides?.[app.name] || {};
			return { ...app, hidden: !!o.hidden, locked: !!o.locked };
		});
	},

	visibleApps () {
		return this.admin ? this.allApps() : this.allApps().filter((app) => !app.hidden);
	},

	setOverride (name, key, value) {
		const overrides = { ...(this.state.overrides || {}) };
		overrides[name] = { ...(overrides[name] || {}), [key]: value };
		this.saveState({ overrides });
	},

	saveState (patch) {
		this.state = { ...this.state, ...patch };
		this.sendSocketNotification("SMARTHOME_SAVE_STATE", { pin: this.adminPinCache, ...this.state });
		this.updateDom(0);
	},

	/* ---------- rendering ---------- */

	getDom () {
		const wrapper = document.createElement("div");
		wrapper.className = `smarthome-apps${this.admin ? " admin" : ""}`;

		this.visibleApps().forEach((app) => wrapper.appendChild(this.renderTile(app)));

		if (this.admin) {
			wrapper.appendChild(this.showAddForm ? this.renderAddForm() : this.renderAddTile());
		}

		const footer = document.createElement("div");
		footer.className = "smarthome-apps-footer";
		if (this.admin) {
			const done = document.createElement("button");
			done.type = "button";
			done.className = "smarthome-admin-done";
			done.textContent = "Done";
			done.addEventListener("click", () => this.leaveAdmin());
			footer.appendChild(done);
			const hint = document.createElement("span");
			hint.className = "dimmed xsmall";
			hint.textContent = "Admin mode: hidden apps are greyed out, locked apps need the PIN to open";
			footer.appendChild(hint);
		} else {
			const adminLink = document.createElement("button");
			adminLink.type = "button";
			adminLink.className = "smarthome-admin-link dimmed xsmall";
			adminLink.textContent = "Admin";
			adminLink.addEventListener("click", () => this.askPin("admin"));
			footer.appendChild(adminLink);
		}
		if (this.status) {
			const note = document.createElement("div");
			note.className = "smarthome-apps-status dimmed xsmall";
			note.textContent = this.status;
			footer.appendChild(note);
		}
		wrapper.appendChild(footer);
		return wrapper;
	},

	renderTile (app) {
		const tile = document.createElement("button");
		tile.className = `smarthome-app-tile${app.hidden ? " hidden-app" : ""}${app.locked ? " locked-app" : ""}`;
		tile.type = "button";
		tile.style.setProperty("--tile-color", app.color || "#333");

		const label = document.createElement("span");
		label.className = "smarthome-app-label";
		label.textContent = app.name;
		tile.appendChild(label);

		if (app.locked) {
			const badge = document.createElement("span");
			badge.className = "smarthome-app-badge";
			badge.textContent = "🔒";
			tile.appendChild(badge);
		}

		if (this.admin) {
			const controls = document.createElement("div");
			controls.className = "smarthome-tile-controls";
			controls.appendChild(this.controlButton(app.hidden ? "Show" : "Hide", () => this.setOverride(app.name, "hidden", !app.hidden)));
			controls.appendChild(this.controlButton(app.locked ? "Unlock" : "Lock", () => this.setOverride(app.name, "locked", !app.locked)));
			if (app.custom) {
				controls.appendChild(this.controlButton("Remove", () => {
					const customApps = this.state.customApps.filter((a) => a.name !== app.name);
					const overrides = { ...this.state.overrides };
					delete overrides[app.name];
					this.saveState({ customApps, overrides });
				}, "danger"));
			}
			tile.appendChild(controls);
		} else {
			tile.addEventListener("click", () => {
				if (app.locked) {
					this.askPin("open", app);
				} else {
					this.openApp(app, tile);
				}
			});
		}
		return tile;
	},

	controlButton (text, onClick, extraClass = "") {
		const b = document.createElement("span");
		b.className = `smarthome-tile-control ${extraClass}`;
		b.textContent = text;
		b.addEventListener("click", (event) => {
			event.stopPropagation();
			this.touchAdmin();
			onClick();
		});
		return b;
	},

	renderAddTile () {
		const tile = document.createElement("button");
		tile.type = "button";
		tile.className = "smarthome-app-tile add-tile";
		tile.innerHTML = "<span class=\"smarthome-app-label\">+ Add app</span>";
		tile.addEventListener("click", () => { this.touchAdmin(); this.showAddForm = true; this.updateDom(0); });
		return tile;
	},

	renderAddForm () {
		const form = document.createElement("form");
		form.className = "smarthome-add-form";
		const name = Object.assign(document.createElement("input"), { placeholder: "Name (e.g. YouTube)", required: true });
		const url = Object.assign(document.createElement("input"), { placeholder: "https://…", type: "url", required: true });
		const color = Object.assign(document.createElement("input"), { type: "color", value: "#444444" });
		const save = Object.assign(document.createElement("button"), { type: "submit", textContent: "Save" });
		const cancel = Object.assign(document.createElement("button"), { type: "button", textContent: "Cancel" });
		cancel.addEventListener("click", () => { this.showAddForm = false; this.updateDom(0); });
		[name, url, color, save, cancel].forEach((el) => form.appendChild(el));
		form.addEventListener("submit", (event) => {
			event.preventDefault();
			this.touchAdmin();
			const appName = name.value.trim();
			if (!appName || this.allApps().some((a) => a.name === appName)) {
				this.status = "An app with that name already exists";
				this.updateDom(0);
				return;
			}
			this.showAddForm = false;
			this.status = null;
			this.saveState({ customApps: [...(this.state.customApps || []), { name: appName, url: url.value.trim(), color: color.value }] });
		});
		setTimeout(() => name.focus(), 50);
		return form;
	},

	/* ---------- admin mode ---------- */

	enterAdmin (pin) {
		this.admin = true;
		this.adminPinCache = pin;
		this.touchAdmin();
		this.updateDom(0);
	},

	touchAdmin () {
		clearTimeout(this.adminTimer);
		this.adminTimer = setTimeout(() => this.leaveAdmin(), this.config.adminTimeout);
	},

	leaveAdmin () {
		clearTimeout(this.adminTimer);
		this.admin = false;
		this.adminPinCache = null;
		this.showAddForm = false;
		this.status = null;
		this.updateDom(0);
	},

	/* ---------- PIN pad ---------- */

	askPin (purpose, app) {
		this.closePin();
		const dialog = document.createElement("div");
		dialog.className = "smarthome-pin";
		dialog.innerHTML = `
			<div class="smarthome-pin-card">
				<div class="smarthome-pin-title">${purpose === "admin" ? "Admin PIN" : `PIN required for ${app.name}`}</div>
				<div class="smarthome-pin-dots"></div>
				<div class="smarthome-pin-keys"></div>
				<div class="smarthome-pin-error"></div>
			</div>`;
		const dots = dialog.querySelector(".smarthome-pin-dots");
		const keys = dialog.querySelector(".smarthome-pin-keys");
		let entered = "";
		const render = () => { dots.textContent = "●".repeat(entered.length) + "○".repeat(Math.max(0, 4 - entered.length)); };
		const submit = () => {
			if (!entered) return;
			this.pendingPin = entered;
			this.sendSocketNotification("SMARTHOME_VERIFY_PIN", { pin: entered, purpose, app });
		};
		["1", "2", "3", "4", "5", "6", "7", "8", "9", "⌫", "0", "OK"].forEach((k) => {
			const key = document.createElement("button");
			key.type = "button";
			key.textContent = k;
			key.addEventListener("click", () => {
				if (k === "⌫") entered = entered.slice(0, -1);
				else if (k === "OK") return submit();
				else if (entered.length < 8) entered += k;
				render();
			});
			keys.appendChild(key);
		});
		const cancel = document.createElement("button");
		cancel.type = "button";
		cancel.className = "smarthome-pin-cancel";
		cancel.textContent = "Cancel";
		cancel.addEventListener("click", () => this.closePin());
		dialog.querySelector(".smarthome-pin-card").appendChild(cancel);

		dialog.onKey = (event) => {
			if (/^[0-9]$/.test(event.key) && entered.length < 8) entered += event.key;
			else if (event.key === "Backspace") entered = entered.slice(0, -1);
			else if (event.key === "Enter") return submit();
			else if (event.key === "Escape") return this.closePin();
			render();
		};
		dialog.showError = (msg) => { dialog.querySelector(".smarthome-pin-error").textContent = msg; entered = ""; render(); };
		render();
		document.body.appendChild(dialog);
		this.pinDialog = dialog;
	},

	closePin () {
		if (this.pinDialog) { this.pinDialog.remove(); this.pinDialog = null; }
	},

	/* ---------- opening apps ---------- */

	openApp (app, tile) {
		if (tile) {
			tile.classList.add("launching");
			setTimeout(() => tile.classList.remove("launching"), 1500);
		}
		const webviewAvailable = typeof document.createElement("webview").getWebContentsId === "function";
		if (this.config.mode === "external" || !webviewAvailable) {
			if (this.config.mode !== "external") Log.warn(`${this.name}: <webview> not available, falling back to external browser`);
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

		view.addEventListener("did-finish-load", () => loading.remove());
		view.addEventListener("did-fail-load", (event) => {
			if (event.errorCode === -3) return;
			loading.textContent = `Couldn't load ${app.name} (${event.errorDescription || event.errorCode})`;
		});
		view.addEventListener("enter-html-full-screen", () => overlay.classList.add("video-fullscreen"));
		view.addEventListener("leave-html-full-screen", () => overlay.classList.remove("video-fullscreen"));
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
		if (this.pinDialog) {
			event.preventDefault();
			this.pinDialog.onKey(event);
			return;
		}
		if (this.overlay && (event.key === "Escape" || event.key === "Backspace")) {
			event.preventDefault();
			this.closeEmbedded();
		}
	},

	/* ---------- socket results ---------- */

	socketNotificationReceived (notification, payload) {
		switch (notification) {
			case "SMARTHOME_STATE":
				this.state = payload || { overrides: {}, customApps: [] };
				this.updateDom(0);
				break;
			case "SMARTHOME_PIN_RESULT":
				if (!this.pinDialog) return;
				if (!payload.ok) {
					this.pinDialog.showError("Wrong PIN");
					return;
				}
				this.closePin();
				if (payload.purpose === "admin") this.enterAdmin(this.pendingPin);
				else if (payload.purpose === "open" && payload.app) this.openApp(payload.app);
				break;
			case "SMARTHOME_OPEN_APP_RESULT":
				this.status = payload.ok ? null : `Couldn't open ${payload.name}: ${payload.error}`;
				this.updateDom(0);
				if (payload.ok) setTimeout(() => { this.status = null; this.updateDom(0); }, 5000);
				break;
		}
	}
});

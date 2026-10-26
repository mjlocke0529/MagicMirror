/* MMM-SmartHome - the dashboard shell
 * Cog (top right) -> PIN -> settings panel. Owns config/smarthome.json via the
 * node_helper, applies layout changes live, and broadcasts state to other
 * SmartHome modules via the "SH_STATE" module notification.
 *
 * Remote / keyboard: arrows move, Enter selects, Esc/Back closes.
 */
Module.register("MMM-SmartHome", {
	defaults: {
		adminPin: "1234",
		cogTimeout: 3000,
		adminTimeout: 3 * 60 * 1000
	},

	getStyles () {
		return ["MMM-SmartHome.css"];
	},

	start () {
		this.state = null;
		this.pinCache = null;
		this.panel = null;
		this.pinDialog = null;
		this.section = "apps";
		this.adminTimer = null;
		this.pendingPin = {};
		document.addEventListener("keydown", (e) => this.onKey(e), true);
		this.sendSocketNotification("SH_INIT");
	},

	getDom () {
		const el = document.createElement("div");
		el.className = "sh-root";
		return el;
	},

	notificationReceived (notification, payload, sender) {
		if (notification === "DOM_OBJECTS_CREATED") {
			this.buildChrome();
			if (this.state) this.sendNotification("SH_STATE", this.state);
		} else if (notification === "SH_REQUEST_PIN" && sender) {
			// another module wants the PIN entered (e.g. a locked app)
			this.askPin(payload.title || "PIN required", () => this.sendNotification("SH_PIN_GRANTED", { token: payload.token }));
		} else if (notification === "SH_FOCUS_COG") {
			this.showCog();
			this.cog.focus();
		} else if (notification === "SH_FOCUS_UP") {
			// from the rail: hero if it's on screen, else the cog
			if (this.moduleVisible("hero")) this.sendNotification("SH_FOCUS_HERO");
			else { this.showCog(); this.cog.focus(); }
		} else if (notification === "SH_FOCUS_DOWN") {
			if (this.moduleVisible("hero")) this.sendNotification("SH_FOCUS_HERO");
			else this.sendNotification("SH_FOCUS_RAIL");
		} else if (notification === "SH_OPEN_SETTINGS") {
			this.openSettings();
		}
	},

	socketNotificationReceived (notification, payload) {
		switch (notification) {
			case "SH_STATE":
				this.state = payload;
				this.sendNotification("SH_STATE", payload);
				if (this.panel) this.renderSection();
				break;
			case "SH_PIN_RESULT": {
				const pending = this.pendingPin[payload.token];
				if (!pending) return;
				delete this.pendingPin[payload.token];
				if (payload.ok) {
					this.pinCache = pending.pin;
					this.closePin();
					pending.onOk();
				} else if (this.pinDialog) {
					this.pinDialog.showError("Wrong PIN");
				}
				break;
			}
			case "SH_TOAST":
				this.toast(payload.message, payload.ok);
				break;
		}
	},

	/* ---------- chrome: cog + toast ---------- */

	buildChrome () {
		const cog = document.createElement("button");
		cog.type = "button";
		cog.className = "sh-cog";
		cog.title = "Settings";
		cog.innerHTML = "&#9881;";
		cog.addEventListener("click", () => this.openSettings());
		document.body.appendChild(cog);
		this.cog = cog;

		document.addEventListener("mousemove", () => this.showCog());

		const toast = document.createElement("div");
		toast.className = "sh-toast";
		document.body.appendChild(toast);
		this.toastEl = toast;
	},

	showCog () {
		this.cog.classList.add("visible");
		clearTimeout(this.cogTimer);
		this.cogTimer = setTimeout(() => { if (document.activeElement !== this.cog) this.cog.classList.remove("visible"); }, this.config.cogTimeout);
	},

	toast (message, ok = true) {
		this.toastEl.textContent = message;
		this.toastEl.className = `sh-toast visible ${ok ? "ok" : "error"}`;
		clearTimeout(this.toastTimer);
		this.toastTimer = setTimeout(() => this.toastEl.classList.remove("visible"), 4000);
	},

	/* ---------- settings flow ---------- */

	openSettings () {
		if (this.panel) return;
		this.askPin("Admin PIN", () => this.openPanel());
	},

	touchAdmin () {
		clearTimeout(this.adminTimer);
		this.adminTimer = setTimeout(() => this.closePanel(), this.config.adminTimeout);
	},

	/* ---------- PIN pad ---------- */

	askPin (title, onOk) {
		this.closePin();
		const token = `${Date.now()}-${Math.random()}`;
		const dialog = document.createElement("div");
		dialog.className = "sh-pin";
		dialog.innerHTML = `<div class="sh-pin-card"><div class="sh-pin-title"></div><div class="sh-pin-dots"></div><div class="sh-pin-keys"></div><div class="sh-pin-error"></div></div>`;
		dialog.querySelector(".sh-pin-title").textContent = title;
		const dots = dialog.querySelector(".sh-pin-dots");
		const keys = dialog.querySelector(".sh-pin-keys");
		let entered = "";
		const render = () => { dots.textContent = "●".repeat(entered.length) + "○".repeat(Math.max(0, 4 - entered.length)); };
		const submit = () => {
			if (!entered) return;
			this.pendingPin[token] = { pin: entered, onOk };
			this.sendSocketNotification("SH_VERIFY_PIN", { pin: entered, token });
		};
		["1", "2", "3", "4", "5", "6", "7", "8", "9", "⌫", "0", "OK"].forEach((k) => {
			const key = document.createElement("button");
			key.type = "button";
			key.className = "sh-focusable";
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
		cancel.className = "sh-pin-cancel sh-focusable";
		cancel.textContent = "Cancel";
		cancel.addEventListener("click", () => this.closePin());
		dialog.querySelector(".sh-pin-card").appendChild(cancel);

		dialog.onKey = (event) => {
			if (/^[0-9]$/.test(event.key)) { if (entered.length < 8) entered += event.key; render(); return true; }
			if (event.key === "Backspace") { entered = entered.slice(0, -1); render(); return true; }
			if (event.key === "Enter" && !(document.activeElement && keys.contains(document.activeElement))) { submit(); return true; }
			if (event.key === "Escape" || event.key === "BrowserBack") { this.closePin(); return true; }
			return false;
		};
		dialog.showError = (msg) => { dialog.querySelector(".sh-pin-error").textContent = msg; entered = ""; render(); };
		render();
		document.body.appendChild(dialog);
		document.body.classList.add("sh-pin-open");
		this.pinDialog = dialog;
		keys.children[4].focus(); // "5"
	},

	closePin () {
		if (!this.pinDialog) return;
		this.pinDialog.remove();
		this.pinDialog = null;
		document.body.classList.remove("sh-pin-open");
	},

	/* ---------- panel ---------- */

	openPanel () {
		const panel = document.createElement("aside");
		panel.className = "sh-panel";
		panel.innerHTML = `
			<div class="sh-panel-head"><span class="sh-panel-title">Settings</span><button type="button" class="sh-panel-close sh-focusable">Done</button></div>
			<nav class="sh-panel-nav"></nav>
			<div class="sh-panel-body"></div>`;
		panel.querySelector(".sh-panel-close").addEventListener("click", () => this.closePanel());
		const nav = panel.querySelector(".sh-panel-nav");
		[["apps", "Apps"], ["layout", "Layout"], ["hero", "Hero"], ["weather", "Weather"], ["system", "System"]].forEach(([id, label]) => {
			const b = document.createElement("button");
			b.type = "button";
			b.className = "sh-nav sh-focusable";
			b.dataset.section = id;
			b.textContent = label;
			b.addEventListener("click", () => { this.section = id; this.renderSection(); });
			nav.appendChild(b);
		});
		document.body.appendChild(panel);
		document.body.classList.add("sh-panel-open");
		this.panel = panel;
		this.touchAdmin();
		this.renderSection();
		requestAnimationFrame(() => panel.classList.add("open"));
	},

	closePanel () {
		if (!this.panel) return;
		clearTimeout(this.adminTimer);
		this.panel.remove();
		this.panel = null;
		this.pinCache = null;
		document.body.classList.remove("sh-panel-open");
		this.sendNotification("SH_SETTINGS_CLOSED");
	},

	renderSection () {
		if (!this.panel || !this.state) return;
		this.panel.querySelectorAll(".sh-nav").forEach((b) => b.classList.toggle("active", b.dataset.section === this.section));
		const body = this.panel.querySelector(".sh-panel-body");
		body.innerHTML = "";
		const builders = { apps: this.sectionApps, layout: this.sectionLayout, hero: this.sectionHero, weather: this.sectionWeather, system: this.sectionSystem };
		builders[this.section].call(this, body);
		const first = body.querySelector(".sh-focusable");
		if (first && !(document.activeElement && this.panel.querySelector(".sh-panel-nav").contains(document.activeElement))) first.focus();
	},

	/* ---------- control helpers ---------- */

	row (label, ...controls) {
		const r = document.createElement("div");
		r.className = "sh-row";
		const l = document.createElement("span");
		l.className = "sh-row-label";
		l.textContent = label;
		r.appendChild(l);
		const c = document.createElement("div");
		c.className = "sh-row-controls";
		controls.forEach((x) => c.appendChild(x));
		r.appendChild(c);
		return r;
	},

	button (text, onClick, cls = "") {
		const b = document.createElement("button");
		b.type = "button";
		b.className = `sh-btn sh-focusable ${cls}`;
		b.textContent = text;
		b.addEventListener("click", () => { this.touchAdmin(); onClick(); });
		return b;
	},

	toggle (on, onChange, labels = ["Off", "On"]) {
		const b = document.createElement("button");
		b.type = "button";
		b.className = `sh-toggle sh-focusable ${on ? "on" : ""}`;
		b.textContent = on ? labels[1] : labels[0];
		b.addEventListener("click", () => { this.touchAdmin(); onChange(!on); });
		b.dataset.cycle = "1";
		return b;
	},

	cycler (options, value, onChange) {
		const b = document.createElement("button");
		b.type = "button";
		b.className = "sh-cycler sh-focusable";
		const idx = Math.max(0, options.findIndex((o) => o.value === value));
		b.textContent = `◀ ${options[idx] ? options[idx].label : value} ▶`;
		const step = (dir) => {
			this.touchAdmin();
			const next = options[(idx + dir + options.length) % options.length];
			onChange(next.value);
		};
		b.addEventListener("click", () => step(1));
		b.stepLeft = () => step(-1);
		b.stepRight = () => step(1);
		return b;
	},

	input (placeholder, type = "text", value = "") {
		const i = document.createElement("input");
		i.className = "sh-input sh-focusable";
		i.type = type;
		i.placeholder = placeholder;
		i.value = value;
		return i;
	},

	note (text) {
		const n = document.createElement("div");
		n.className = "sh-note";
		n.textContent = text;
		return n;
	},

	save (patch, relaunch = false) {
		this.sendSocketNotification("SH_UPDATE", { pin: this.pinCache, patch, relaunch });
	},

	/* ---------- sections ---------- */

	sectionApps (body) {
		const apps = this.state.apps.map((a) => ({ ...a }));
		const commit = () => this.save({ apps });

		apps.forEach((app, i) => {
			const controls = [
				this.toggle(!app.hidden, (v) => { app.hidden = !v; commit(); }, ["Hidden", "Shown"]),
				this.toggle(!!app.locked, (v) => { app.locked = v; commit(); }, ["Unlocked", "Locked"]),
				this.button("▲", () => { if (i > 0) { [apps[i - 1], apps[i]] = [apps[i], apps[i - 1]]; commit(); } }, "sh-small"),
				this.button("▼", () => { if (i < apps.length - 1) { [apps[i + 1], apps[i]] = [apps[i], apps[i + 1]]; commit(); } }, "sh-small"),
				this.button("Remove", () => { apps.splice(i, 1); commit(); }, "sh-danger sh-small")
			];
			body.appendChild(this.row(app.name, ...controls));
		});

		const name = this.input("Name");
		const url = this.input("https://…", "url");
		const color = this.input("", "color", "#444444");
		const add = this.button("Add app", () => {
			const n = name.value.trim();
			const u = url.value.trim();
			if (!n || !u) return this.toast("Name and URL are required", false);
			if (apps.some((a) => a.name.toLowerCase() === n.toLowerCase())) return this.toast("That name is already used", false);
			apps.push({ name: n, url: u, color: color.value, hidden: false, locked: false });
			commit();
		});
		const form = document.createElement("div");
		form.className = "sh-form";
		form.append(name, url, color, add);
		body.appendChild(this.note("Add an app"));
		body.appendChild(form);
	},

	sectionLayout (body) {
		const modules = this.state.modules.map((m) => ({ ...m }));
		const posOptions = this.state.positions.map((p) => ({ value: p, label: p.replace("_", " ") }));
		body.appendChild(this.note("Turning a module on that was off at startup restarts the mirror (about 3 seconds)."));

		modules.forEach((m) => {
			const enabled = this.toggle(m.enabled !== false, (v) => {
				m.enabled = v;
				const live = this.applyEnabled(m.id, v);
				this.save({ modules }, !live);
			});
			const pos = this.cycler(posOptions, m.position, (v) => {
				m.position = v;
				this.applyPosition(m.id, v);
				this.save({ modules });
			});
			body.appendChild(this.row(m.name || m.module, enabled, pos));
		});
	},

	sectionHero (body) {
		const hero = { ...this.state.hero };
		body.appendChild(this.note("Trending titles come from TMDB (themoviedb.org). Services follow the apps in your rail."));
		body.appendChild(this.row("TMDB API key", this.note(hero.tmdbApiKey ? "Set ✓" : "Not set")));
		const key = this.input("Paste TMDB API key (v3)", "password");
		const saveKey = this.button("Save key", () => {
			if (!key.value.trim()) return;
			this.save({ hero: { tmdbApiKey: key.value.trim() } }, true);
			key.value = "";
		});
		const form = document.createElement("div");
		form.className = "sh-form";
		form.append(key, saveKey);
		body.appendChild(form);

		const typeOptions = [{ value: "movie,tv", label: "Movies & series" }, { value: "movie", label: "Movies only" }, { value: "tv", label: "Series only" }];
		body.appendChild(this.row("Show", this.cycler(typeOptions, (hero.types || []).join(","), (v) => this.save({ hero: { types: v.split(",") } }, true))));
		const speeds = [{ value: 6000, label: "Every 6 s" }, { value: 10000, label: "Every 10 s" }, { value: 15000, label: "Every 15 s" }, { value: 30000, label: "Every 30 s" }];
		body.appendChild(this.row("Slide", this.cycler(speeds, hero.interval, (v) => this.save({ hero: { interval: v } }, true))));
		body.appendChild(this.note("Changes here restart the mirror."));
	},

	sectionWeather (body) {
		body.appendChild(this.row("Current location", this.note(this.state.weather.label || `${this.state.weather.lat}, ${this.state.weather.lon}`)));
		const city = this.input("City, State (e.g. Gig Harbor, WA)");
		const set = this.button("Set location", () => {
			if (!city.value.trim()) return;
			this.toast(`Looking up ${city.value.trim()}…`);
			this.sendSocketNotification("SH_SET_WEATHER", { pin: this.pinCache, query: city.value.trim() });
		});
		const form = document.createElement("div");
		form.className = "sh-form";
		form.append(city, set);
		body.appendChild(form);

		const general = { ...this.state.general };
		body.appendChild(this.row("Units", this.cycler([{ value: "imperial", label: "°F / mph" }, { value: "metric", label: "°C / km/h" }], general.units, (v) => { general.units = v; this.save({ general }, true); })));
		body.appendChild(this.row("Clock", this.cycler([{ value: 12, label: "12-hour" }, { value: 24, label: "24-hour" }], general.timeFormat, (v) => { general.timeFormat = v; this.save({ general }, true); })));
		body.appendChild(this.note("Changing units or clock format restarts the mirror."));
	},

	sectionSystem (body) {
		const current = this.input("Current PIN", "password");
		const next = this.input("New PIN (4-8 digits)", "password");
		const change = this.button("Change PIN", () => {
			this.sendSocketNotification("SH_CHANGE_PIN", { pin: current.value, newPin: next.value });
			current.value = ""; next.value = "";
		});
		const form = document.createElement("div");
		form.className = "sh-form";
		form.append(current, next, change);
		body.appendChild(this.note("Admin PIN"));
		body.appendChild(form);

		body.appendChild(this.row("Mirror", this.button("Restart", () => this.sendSocketNotification("SH_RELAUNCH", { pin: this.pinCache }))));
		body.appendChild(this.note("Settings file: config/smarthome.json"));
	},

	/* ---------- live layout changes ---------- */

	moduleVisible (id) {
		const m = this.findModule(id);
		return !!m && !m.hidden;
	},

	findModule (id) {
		return MM.getModules().find((m) => (m.data.classes || "").split(" ").includes(`sh-${id}`));
	},

	// returns true if applied live, false if a restart is needed
	applyEnabled (id, on) {
		const m = this.findModule(id);
		if (!m) return false;
		if (on) m.show(400, () => {}, { lockString: "sh" });
		else m.hide(400, () => {}, { lockString: "sh" });
		return true;
	},

	applyPosition (id, position) {
		const m = this.findModule(id);
		if (!m) return;
		const el = document.getElementById(m.identifier);
		const region = document.querySelector(`.region.${position.replace("_", ".")} .container`);
		if (el && region) {
			region.appendChild(el);
			m.data.position = position;
		}
	},

	/* ---------- remote / keyboard ---------- */

	onKey (event) {
		if (this.pinDialog) {
			if (this.pinDialog.onKey(event)) { event.preventDefault(); event.stopPropagation(); return; }
			if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) {
				this.moveFocus(this.pinDialog, event.key, 3);
				event.preventDefault(); event.stopPropagation();
			}
			return;
		}
		if (this.panel) {
			this.touchAdmin();
			const active = document.activeElement;
			const inInput = active && active.tagName === "INPUT" && active.type !== "color";
			if (event.key === "Escape" || event.key === "BrowserBack") { this.closePanel(); }
			else if (event.key === "ArrowUp" || event.key === "ArrowDown") { this.moveFocus(this.panel, event.key); }
			else if ((event.key === "ArrowLeft" || event.key === "ArrowRight") && !inInput) {
				if (active && active.classList.contains("sh-nav")) this.moveFocus(this.panel.querySelector(".sh-panel-nav"), event.key === "ArrowLeft" ? "ArrowUp" : "ArrowDown");
				else if (active && active.stepLeft) (event.key === "ArrowLeft" ? active.stepLeft : active.stepRight)();
				else if (active && active.dataset.cycle) active.click();
				else this.moveFocus(this.panel, event.key === "ArrowLeft" ? "ArrowUp" : "ArrowDown");
			}
			else if (event.key === "Enter" && active && active.classList.contains("sh-focusable") && !inInput) { active.click(); }
			else return; // let typing through
			event.preventDefault(); event.stopPropagation();
			return;
		}
		// nothing of ours open: let the cog be reachable from the remote
		if (this.cog && document.activeElement === this.cog) {
			if (event.key === "Enter") { this.openSettings(); event.preventDefault(); }
			else if (event.key === "ArrowDown" || event.key === "Escape" || event.key === "BrowserBack") { this.cog.blur(); this.sendNotification("SH_FOCUS_DOWN"); event.preventDefault(); }
			event.stopPropagation();
		}
	},

	moveFocus (container, key, columns = 1) {
		const items = [...container.querySelectorAll(".sh-focusable")].filter((el) => el.offsetParent !== null);
		if (!items.length) return;
		const idx = items.indexOf(document.activeElement);
		const delta = { ArrowUp: -columns, ArrowDown: columns, ArrowLeft: -1, ArrowRight: 1 }[key] || 0;
		let next = idx === -1 ? 0 : idx + delta;
		if (next < 0) next = 0;
		if (next >= items.length) next = items.length - 1;
		items[next].focus();
		items[next].scrollIntoView({ block: "nearest" });
	}
});

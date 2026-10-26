/* MMM-SmartHome - the dashboard shell
 * Owns config/smarthome.json via the node_helper, lays the screen out from
 * layout.sections (its own grid over MagicMirror's regions), applies every
 * settings change live, and broadcasts state to other SmartHome modules via
 * the "SH_STATE" module notification.
 *
 * Cog (top right) -> settings panel. Remote / keyboard: arrows move, Enter
 * selects, Esc/Back closes.
 */
Module.register("MMM-SmartHome", {
	defaults: {
		adminPin: "1234",
		cogTimeout: 3000,
		adminTimeout: 3 * 60 * 1000
	},

	SPLITS: { "1": [1], "2": [1, 1], "3": [1, 1, 1], "1-2": [1, 2], "2-1": [2, 1] },
	SPLIT_LABELS: { "1": "Single", "2": "1 × 2", "3": "1 × 3", "1-2": "⅓ + ⅔", "2-1": "⅔ + ⅓" },
	SECTION_NAMES: { upper: "Upper third", middle: "Middle", lower: "Lower third", bottombar: "Bottom bar" },
	PRESETS: {
		Streaming: { topbar: true, sections: [{ id: "upper", enabled: true, size: 2, split: "1", slots: ["hero"] }, { id: "middle", enabled: true, size: 1, split: "1", slots: ["apps"] }, { id: "lower", enabled: false, size: 1, split: "3", slots: ["clock", "weather", "calendar"] }], bottombar: { enabled: true, slots: ["news"] } },
		Dashboard: { topbar: true, sections: [{ id: "upper", enabled: true, size: 1, split: "1-2", slots: ["clock", "hero"] }, { id: "middle", enabled: true, size: 1, split: "1", slots: ["apps"] }, { id: "lower", enabled: true, size: 1, split: "3", slots: ["calendar", "weather", "forecast"] }], bottombar: { enabled: true, slots: ["news"] } },
		"Family board": { topbar: true, sections: [{ id: "upper", enabled: true, size: 1, split: "2-1", slots: ["calendar", "weather"] }, { id: "middle", enabled: true, size: 1, split: "1", slots: ["apps"] }, { id: "lower", enabled: true, size: 1, split: "2", slots: ["forecast", "compliments"] }], bottombar: { enabled: false, slots: ["news"] } },
		Minimal: { topbar: false, sections: [{ id: "upper", enabled: true, size: 1, split: "2-1", slots: ["clock", "weather"] }, { id: "middle", enabled: true, size: 1, split: "1", slots: ["apps"] }, { id: "lower", enabled: false, size: 1, split: "1", slots: ["compliments"] }], bottombar: { enabled: false, slots: ["news"] } }
	},

	getStyles () {
		return ["MMM-SmartHome.css"];
	},

	start () {
		this.state = null;
		this.pinCache = null;
		this.panel = null;
		this.pinDialog = null;
		this.section = "layout";
		this.adminTimer = null;
		this.pendingPin = {};
		this.placed = new Set();
		this.appliedLayout = null;
		this.domReady = false;
		this.drag = null;
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
			this.domReady = true;
			this.buildChrome();
			if (this.state) {
				this.applyAppearance(this.state.appearance);
				this.applyLayout(this.state.layout);
				this.sendNotification("SH_STATE", this.state);
			}
		} else if (notification === "SH_REQUEST_PIN" && sender) {
			if (!this.lockEnabled()) return this.sendNotification("SH_PIN_GRANTED", { token: payload.token });
			this.askPin(payload.title || "PIN required", () => this.sendNotification("SH_PIN_GRANTED", { token: payload.token }));
		} else if (notification === "SH_FOCUS_COG") {
			this.showCog();
			this.cog.focus();
		} else if (notification === "SH_FOCUS_UP") {
			this.routeFocus(-1, (payload && payload.from) || "rail");
		} else if (notification === "SH_FOCUS_DOWN") {
			this.routeFocus(1, (payload && payload.from) || "cog");
		} else if (notification === "SH_OPEN_SETTINGS") {
			this.openSettings();
		} else if (notification === "SH_HOME") {
			this.closePin();
			this.closePanel();
		}
	},

	socketNotificationReceived (notification, payload) {
		switch (notification) {
			case "SH_STATE": {
				const prev = this.state;
				this.state = payload;
				window.SHRemote.map = { ...window.SHRemote.defaults, ...(payload.remote || {}) };
				this.sendNotification("SH_STATE", payload);
				if (this.domReady) {
					if (prev) this.applyLive(prev, payload);
					this.applyAppearance(payload.appearance);
					this.applyLayout(payload.layout);
				}
				if (this.panel) this.renderSection();
				break;
			}
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

	/* ======================================================================
	 * Layout engine: a flex grid over MagicMirror's regions
	 * ====================================================================== */

	buildGrid () {
		if (this.grid) return;
		const grid = document.createElement("div");
		grid.className = "sh-grid";
		document.body.appendChild(grid);
		const parking = document.createElement("div");
		parking.className = "sh-parking";
		parking.hidden = true;
		document.body.appendChild(parking);
		this.grid = grid;
		this.parking = parking;
	},

	moduleWrapper (id) {
		const m = this.findModule(id);
		return m ? document.getElementById(m.identifier) : null;
	},

	applyLayout (layout) {
		if (!layout) return;
		this.buildGrid();
		const key = JSON.stringify(layout);
		if (key === this.appliedLayout) return;
		this.appliedLayout = key;

		// park everything first so nothing is left behind in a removed slot
		for (const m of MM.getModules()) {
			if (!(m.data.classes || "").includes("sh-mod")) continue;
			const el = document.getElementById(m.identifier);
			if (el) this.parking.appendChild(el);
		}
		this.placed = new Set();
		this.grid.innerHTML = "";

		const slot = (sec, i, weight, id) => {
			const s = document.createElement("div");
			s.className = "sh-slot";
			s.dataset.sec = sec;
			s.dataset.i = i;
			s.dataset.tag = sec === "topbar" ? "top bar" : sec === "bottombar" ? "bottom" : `${sec} · ${i + 1}`;
			s.style.flex = `${weight} 1 0`;
			const el = id ? this.moduleWrapper(id) : null;
			if (el) {
				s.appendChild(el);
				this.placed.add(id);
				s.dataset.module = id;
			} else {
				const empty = document.createElement("div");
				empty.className = "sh-slot-empty";
				empty.textContent = "Empty";
				s.appendChild(empty);
			}
			this.wireSlot(s);
			return s;
		};

		if (layout.topbar) {
			const row = document.createElement("div");
			row.className = "sh-grid-row sh-grid-topbar";
			row.appendChild(slot("topbar", 0, 1, "topbar"));
			this.grid.appendChild(row);
		}
		for (const sec of layout.sections || []) {
			if (!sec.enabled) continue;
			const row = document.createElement("div");
			row.className = "sh-grid-row";
			row.dataset.sec = sec.id;
			row.style.flex = `${sec.size || 1} 1 0`;
			const parts = this.SPLITS[sec.split] || [1];
			parts.forEach((w, i) => row.appendChild(slot(sec.id, i, w, sec.slots[i])));
			this.grid.appendChild(row);
		}
		if (layout.bottombar && layout.bottombar.enabled) {
			const row = document.createElement("div");
			row.className = "sh-grid-row sh-grid-bottom";
			row.appendChild(slot("bottombar", 0, 1, layout.bottombar.slots[0]));
			this.grid.appendChild(row);
		}
		for (const m of MM.getModules()) {
			if ((m.data.classes || "").includes("sh-mod")) m.updateDom(0);
		}
	},

	/* ---------- drag & drop on the live screen (Layout tab open) ---------- */

	wireSlot (s) {
		s.addEventListener("dragover", (e) => { if (!this.editing()) return; e.preventDefault(); s.classList.add("sh-drop"); });
		s.addEventListener("dragleave", () => s.classList.remove("sh-drop"));
		s.addEventListener("drop", (e) => {
			if (!this.editing() || !this.drag) return;
			e.preventDefault();
			s.classList.remove("sh-drop");
			const to = { sec: s.dataset.sec, i: +s.dataset.i };
			if (to.sec === "topbar") return;
			if (this.drag.module) this.setSlot(to, this.drag.module);
			else if (this.drag.from && this.drag.from.sec !== "topbar") this.swapSlots(this.drag.from, to);
			this.drag = null;
			this.commitLayout();
		});
		const el = s.querySelector(".module");
		if (el) {
			el.draggable = true;
			el.addEventListener("dragstart", (e) => {
				if (!this.editing()) { e.preventDefault(); return; }
				this.drag = { from: { sec: s.dataset.sec, i: +s.dataset.i } };
				e.dataTransfer.effectAllowed = "move";
			});
		}
	},

	editing () {
		return !!this.panel && this.section === "layout";
	},

	layoutDraft () {
		return JSON.parse(JSON.stringify(this.state.layout));
	},

	slotsOf (layout, sec) {
		return sec === "bottombar" ? layout.bottombar.slots : layout.sections.find((s) => s.id === sec).slots;
	},

	setSlot (p, id) {
		const layout = this.layoutDraft();
		this.slotsOf(layout, p.sec)[p.i] = id;
		this.pendingLayout = layout;
	},

	swapSlots (a, b) {
		const layout = this.layoutDraft();
		const sa = this.slotsOf(layout, a.sec);
		const sb = this.slotsOf(layout, b.sec);
		const av = sa[a.i] || null;
		const bv = sb[b.i] || null;
		sa[a.i] = bv;
		sb[b.i] = av;
		this.pendingLayout = layout;
	},

	commitLayout (layout) {
		const next = layout || this.pendingLayout;
		this.pendingLayout = null;
		if (!next) return;
		this.state.layout = next;
		this.applyLayout(next);
		this.save({ layout: next });
		if (this.panel) this.renderSection();
	},

	/* ======================================================================
	 * Chrome: cog + toast
	 * ====================================================================== */

	buildChrome () {
		this.buildGrid();
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

	/* ======================================================================
	 * Settings flow + PIN
	 * ====================================================================== */

	lockEnabled () {
		return !!(this.state && this.state.general && this.state.general.adminLock === true);
	},

	openSettings () {
		if (this.panel) return;
		if (!this.lockEnabled()) return this.openPanel();
		this.askPin("Admin PIN", () => this.openPanel());
	},

	touchAdmin () {
		clearTimeout(this.adminTimer);
		this.adminTimer = setTimeout(() => this.closePanel(), this.config.adminTimeout);
	},

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
		dialog.onKey = (event, action) => {
			if (/^[0-9]$/.test(event.key)) { if (entered.length < 8) entered += event.key; render(); return true; }
			if (event.key === "Backspace") { entered = entered.slice(0, -1); render(); return true; }
			if (action === "select" && !(document.activeElement && keys.contains(document.activeElement))) { submit(); return true; }
			if (action === "back" || action === "home") { this.closePin(); return true; }
			return false;
		};
		dialog.showError = (msg) => { dialog.querySelector(".sh-pin-error").textContent = msg; entered = ""; render(); };
		render();
		document.body.appendChild(dialog);
		document.body.classList.add("sh-pin-open");
		this.pinDialog = dialog;
		keys.children[4].focus();
	},

	closePin () {
		if (!this.pinDialog) return;
		this.pinDialog.remove();
		this.pinDialog = null;
		document.body.classList.remove("sh-pin-open");
	},

	/* ======================================================================
	 * Panel
	 * ====================================================================== */

	openPanel () {
		const panel = document.createElement("aside");
		panel.className = "sh-panel";
		panel.innerHTML = `
			<div class="sh-panel-head"><span class="sh-panel-title">Settings</span><button type="button" class="sh-panel-close sh-focusable">Done</button></div>
			<nav class="sh-panel-nav"></nav>
			<div class="sh-panel-body"></div>`;
		panel.querySelector(".sh-panel-close").addEventListener("click", () => this.closePanel());
		const nav = panel.querySelector(".sh-panel-nav");
		[["layout", "Layout"], ["apps", "Apps"], ["theme", "Theme"], ["hero", "Hero"], ["weather", "Weather"], ["remote", "Remote"], ["system", "System"]].forEach(([id, label]) => {
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
		document.body.classList.remove("sh-panel-open", "sh-layout-edit");
		this.sendNotification("SH_SETTINGS_CLOSED");
	},

	renderSection () {
		if (!this.panel || !this.state) return;
		this.panel.querySelectorAll(".sh-nav").forEach((b) => b.classList.toggle("active", b.dataset.section === this.section));
		document.body.classList.toggle("sh-layout-edit", this.section === "layout");
		const body = this.panel.querySelector(".sh-panel-body");
		// keep scroll position and focus across a rebuild of the same section
		const sameSection = body.dataset.section === this.section;
		const scroll = sameSection ? body.scrollTop : 0;
		const prevFocus = sameSection ? [...body.querySelectorAll(".sh-focusable")].indexOf(document.activeElement) : -1;
		body.dataset.section = this.section;
		body.innerHTML = "";
		const builders = { layout: this.sectionLayout, apps: this.sectionApps, theme: this.sectionTheme, hero: this.sectionHero, weather: this.sectionWeather, remote: this.sectionRemote, system: this.sectionSystem };
		builders[this.section].call(this, body);
		if (sameSection) {
			body.scrollTop = scroll;
			const items = body.querySelectorAll(".sh-focusable");
			if (prevFocus >= 0 && items.length) items[Math.min(prevFocus, items.length - 1)].focus({ preventScroll: true });
			return;
		}
		const first = body.querySelector(".sh-focusable");
		if (first && !(document.activeElement && this.panel.querySelector(".sh-panel-nav").contains(document.activeElement))) first.focus({ preventScroll: true });
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

	save (patch) {
		this.sendSocketNotification("SH_UPDATE", { pin: this.pinCache, patch });
	},

	/* ======================================================================
	 * Sections
	 * ====================================================================== */

	sectionLayout (body) {
		const layout = this.layoutDraft();
		const commit = () => this.commitLayout(layout);
		const moduleOptions = [{ value: null, label: "Empty" }, ...this.state.modules.filter((m) => m.id !== "topbar").map((m) => ({ value: m.id, label: m.name || m.module }))];

		body.appendChild(this.note("The screen behind this panel is live: drag modules between the outlined slots, or use the controls here."));

		const presets = document.createElement("div");
		presets.className = "sh-form";
		Object.keys(this.PRESETS).forEach((name) => presets.appendChild(this.button(name, () => this.commitLayout(JSON.parse(JSON.stringify(this.PRESETS[name]))))));
		body.appendChild(this.note("Presets"));
		body.appendChild(presets);

		body.appendChild(this.row("Top bar", this.toggle(!!layout.topbar, (v) => { layout.topbar = v; commit(); })));

		const sections = [...layout.sections.map((s) => ({ ...s, kind: "section" })), { id: "bottombar", kind: "bar", enabled: layout.bottombar.enabled, slots: layout.bottombar.slots }];
		sections.forEach((sec, secIdx) => {
			const title = this.SECTION_NAMES[sec.id] || sec.id;
			const head = document.createElement("div");
			head.className = "sh-section-head";
			head.textContent = title;
			body.appendChild(head);
			body.appendChild(this.row("On screen", this.toggle(sec.enabled !== false, (v) => {
				if (sec.kind === "bar") layout.bottombar.enabled = v; else layout.sections.find((s) => s.id === sec.id).enabled = v;
				commit();
			})));
			if (sec.kind === "section") {
				const target = layout.sections.find((s) => s.id === sec.id);
				body.appendChild(this.row("Height", this.cycler([{ value: 1, label: "⅓ of screen" }, { value: 2, label: "⅔ of screen" }], sec.size || 1, (v) => { target.size = v; commit(); })));
				body.appendChild(this.row("Split", this.cycler(Object.keys(this.SPLITS).map((k) => ({ value: k, label: this.SPLIT_LABELS[k] })), sec.split || "1", (v) => { target.split = v; commit(); })));
			}
			const parts = sec.kind === "bar" ? [1] : (this.SPLITS[sec.split] || [1]);
			parts.forEach((_, i) => {
				const current = sec.slots[i] || null;
				const picker = this.cycler(moduleOptions, current, (v) => { this.slotsOf(layout, sec.id)[i] = v; commit(); });
				const arrows = document.createElement("div");
				arrows.className = "sh-arrows";
				const mk = (txt, disabled, fn) => { const b = this.button(txt, () => { fn(); commit(); }, "sh-small"); b.disabled = disabled; return b; };
				const swap = (a, b) => { const sa = this.slotsOf(layout, a.sec); const sb = this.slotsOf(layout, b.sec); const t = sa[a.i] || null; sa[a.i] = sb[b.i] || null; sb[b.i] = t; };
				const lastSection = layout.sections[layout.sections.length - 1].id;
				arrows.appendChild(mk("◀", i === 0, () => swap({ sec: sec.id, i }, { sec: sec.id, i: i - 1 })));
				arrows.appendChild(mk("▶", i >= parts.length - 1, () => swap({ sec: sec.id, i }, { sec: sec.id, i: i + 1 })));
				arrows.appendChild(mk("▲", sec.kind === "section" && secIdx === 0, () => swap({ sec: sec.id, i }, { sec: sec.kind === "bar" ? lastSection : layout.sections[secIdx - 1].id, i: 0 })));
				arrows.appendChild(mk("▼", sec.kind === "bar", () => swap({ sec: sec.id, i }, { sec: secIdx >= layout.sections.length - 1 ? "bottombar" : layout.sections[secIdx + 1].id, i: 0 })));
				body.appendChild(this.row(`Slot ${i + 1}`, picker, arrows));
			});
		});

		body.appendChild(this.note("Module palette: drag onto a slot on the screen"));
		const palette = document.createElement("div");
		palette.className = "sh-form";
		this.state.modules.filter((m) => m.id !== "topbar").forEach((m) => {
			const chip = document.createElement("span");
			chip.className = `sh-chip${this.placed.has(m.id) ? " placed" : ""}`;
			chip.textContent = m.name || m.module;
			chip.draggable = true;
			chip.addEventListener("dragstart", (e) => { this.drag = { module: m.id }; e.dataTransfer.effectAllowed = "copy"; });
			palette.appendChild(chip);
		});
		body.appendChild(palette);
	},

	sectionApps (body) {
		const apps = this.state.apps.map((a) => ({ ...a }));
		const commit = () => this.save({ apps });
		apps.forEach((app, i) => {
			body.appendChild(this.row(app.name,
				this.toggle(!app.hidden, (v) => { app.hidden = !v; commit(); }, ["Hidden", "Shown"]),
				this.toggle(!!app.locked, (v) => { app.locked = v; commit(); }, ["Unlocked", "Locked"]),
				this.button("▲", () => { if (i > 0) { [apps[i - 1], apps[i]] = [apps[i], apps[i - 1]]; commit(); } }, "sh-small"),
				this.button("▼", () => { if (i < apps.length - 1) { [apps[i + 1], apps[i]] = [apps[i], apps[i + 1]]; commit(); } }, "sh-small"),
				this.button("Remove", () => { apps.splice(i, 1); commit(); }, "sh-danger sh-small")));
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

	sectionTheme (body) {
		const appearance = { ...this.state.appearance };
		const themes = [{ value: "tiles", label: "Tiles" }, { value: "nospacing", label: "No spacing" }, { value: "fullwidth", label: "Full width" }];
		body.appendChild(this.row("Theme", this.cycler(themes, appearance.theme, (v) => { appearance.theme = v; this.save({ appearance }); })));
		const accent = this.input("", "color", appearance.accent || "#ffffff");
		accent.addEventListener("change", () => { appearance.accent = accent.value; this.save({ appearance }); });
		body.appendChild(this.row("Accent color", accent));
		body.appendChild(this.note("Tiles: modules in cards with gaps · No spacing: cards edge to edge · Full width: no margins, hero to the top edge, top bar floating over it."));

		const tb = { ...this.state.topbar, links: [...(this.state.topbar.links || [])] };
		const commit = () => this.save({ topbar: tb });
		body.appendChild(this.note("Top bar"));
		body.appendChild(this.row("Greeting", this.toggle(tb.greeting !== false, (v) => { tb.greeting = v; commit(); })));
		const name = this.input("Name for the greeting (e.g. Locke family)", "text", tb.name || "");
		name.addEventListener("change", () => { tb.name = name.value.trim(); commit(); });
		body.appendChild(this.row("Greet as", name));
		body.appendChild(this.row("Search box", this.toggle(tb.search !== false, (v) => { tb.search = v; commit(); })));
		body.appendChild(this.row("Weather chip", this.toggle(tb.showWeather !== false, (v) => { tb.showWeather = v; commit(); })));
		body.appendChild(this.row("Time", this.toggle(tb.showTime !== false, (v) => { tb.showTime = v; commit(); })));
		body.appendChild(this.note("Quick links"));
		tb.links.forEach((link, i) => body.appendChild(this.row(link.name, this.button("Remove", () => { tb.links.splice(i, 1); commit(); }, "sh-danger sh-small"))));
		const ln = this.input("Name");
		const lu = this.input("https://…", "url");
		const add = this.button("Add link", () => {
			if (!ln.value.trim() || !lu.value.trim()) return this.toast("Name and URL are required", false);
			tb.links.push({ name: ln.value.trim(), url: lu.value.trim() });
			commit();
		});
		const form = document.createElement("div");
		form.className = "sh-form";
		form.append(ln, lu, add);
		body.appendChild(form);
	},

	sectionHero (body) {
		const hero = { ...this.state.hero };
		body.appendChild(this.note("Trending titles come from TMDB (themoviedb.org). Services follow the apps in your rail."));
		body.appendChild(this.row("TMDB API key", this.note(hero.tmdbApiKey ? "Set ✓" : "Not set")));
		const key = this.input("Paste TMDB API key (v3)", "password");
		const saveKey = this.button("Save key", () => {
			if (!key.value.trim()) return;
			this.save({ hero: { tmdbApiKey: key.value.trim() } });
			key.value = "";
		});
		const form = document.createElement("div");
		form.className = "sh-form";
		form.append(key, saveKey);
		body.appendChild(form);
		const typeOptions = [{ value: "movie,tv", label: "Movies & series" }, { value: "movie", label: "Movies only" }, { value: "tv", label: "Series only" }];
		body.appendChild(this.row("Show", this.cycler(typeOptions, (hero.types || []).join(","), (v) => this.save({ hero: { types: v.split(",") } }))));
		const speeds = [{ value: 6000, label: "Every 6 s" }, { value: 10000, label: "Every 10 s" }, { value: 15000, label: "Every 15 s" }, { value: 30000, label: "Every 30 s" }];
		body.appendChild(this.row("Slide", this.cycler(speeds, hero.interval, (v) => this.save({ hero: { interval: v } }))));
	},

	sectionWeather (body) {
		body.appendChild(this.row("Current location", this.note(this.state.weather.label || `${this.state.weather.lat}, ${this.state.weather.lon}`)));
		const city = this.input("City, State (e.g. Tacoma, WA)");
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
		body.appendChild(this.row("Units", this.cycler([{ value: "imperial", label: "°F / mph" }, { value: "metric", label: "°C / km/h" }], general.units, (v) => { general.units = v; this.save({ general }); })));
		body.appendChild(this.row("Clock", this.cycler([{ value: 12, label: "12-hour" }, { value: 24, label: "24-hour" }], general.timeFormat, (v) => { general.timeFormat = v; this.save({ general }); })));
	},

	sectionRemote (body) {
		const remote = JSON.parse(JSON.stringify(window.SHRemote.current()));
		body.appendChild(this.note("Press Learn, then the button on your remote. Several keys can map to one action; Reset restores the defaults for that action."));
		window.SHRemote.ACTIONS.forEach(([action, label]) => {
			const keys = this.note((remote[action] || []).join(" · ") || "—");
			keys.className = "sh-keys";
			const learn = this.button(this.learning === action ? "Press a button…" : "Learn", () => {
				this.learning = action;
				this.toast(`Press the remote button for "${label}"`);
				this.renderSection();
			}, this.learning === action ? "sh-learning" : "");
			const reset = this.button("Reset", () => {
				remote[action] = [...window.SHRemote.defaults[action]];
				this.save({ remote });
			}, "sh-small");
			body.appendChild(this.row(label, keys, learn, reset));
		});
		body.appendChild(this.note("Inside Netflix / Disney+, Back leaves fullscreen video first and exits the app on the next press; Home always exits."));
	},

	learnKey (event) {
		const action = this.learning;
		this.learning = null;
		const key = window.SHRemote.keyOf(event);
		if (!key) return;
		const remote = JSON.parse(JSON.stringify(window.SHRemote.current()));
		// one key belongs to one action
		for (const a of Object.keys(remote)) remote[a] = (remote[a] || []).filter((k) => k !== key);
		remote[action] = [key, ...(remote[action] || [])];
		this.save({ remote });
		this.toast(`"${key}" → ${action}`);
	},

	sectionSystem (body) {
		const general = { ...this.state.general };
		body.appendChild(this.row("Admin lock (PIN)", this.toggle(general.adminLock === true, (v) => {
			general.adminLock = v;
			this.save({ general });
			this.toast(v ? "PIN now required for settings and locked apps" : "Admin lock off - no PIN needed");
		})));
		body.appendChild(this.note(general.adminLock ? "Settings and locked apps require the PIN." : "Admin lock is off: settings open without a PIN and locked apps open freely."));
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
		body.appendChild(this.note("Settings file: config/smarthome.json · Layout designer: /modules/MMM-SmartHome/design/layout-designer.html"));
	},

	/* ======================================================================
	 * Live application of settings
	 * ====================================================================== */

	applyLive (prev, next) {
		const g0 = prev.general || {};
		const g1 = next.general || {};
		if (g0.units !== g1.units || g0.timeFormat !== g1.timeFormat) this.applyGeneral(g1);
		const w0 = prev.weather || {};
		const w1 = next.weather || {};
		if (w0.lat !== w1.lat || w0.lon !== w1.lon) this.applyWeather(w1);
		if (JSON.stringify(prev.hero) !== JSON.stringify(next.hero)) this.sendNotification("SH_HERO_CONFIG", next.hero);
	},

	applyAppearance (appearance) {
		const a = appearance || {};
		document.body.dataset.shTheme = a.theme || "tiles";
		document.documentElement.style.setProperty("--sh-accent", a.accent || "#ffffff");
	},

	applyGeneral (general) {
		globalThis.config.units = general.units;
		globalThis.config.timeFormat = general.timeFormat;
		for (const m of MM.getModules()) {
			if (m.name === "clock") {
				m.config.timeFormat = general.timeFormat;
				m.updateDom(0);
			} else if (m.name === "weather") {
				m.config.units = general.units;
				m.config.tempUnits = general.units;
				m.config.windUnits = general.units;
				m.config.timeFormat = general.timeFormat;
				this.reinitWeather(m);
			}
		}
	},

	applyWeather (weather) {
		for (const m of MM.getModules()) {
			if (m.name !== "weather") continue;
			m.config.lat = weather.lat;
			m.config.lon = weather.lon;
			this.reinitWeather(m);
		}
	},

	reinitWeather (m) {
		m.sendSocketNotification("STOP_WEATHER", { instanceId: m.instanceId });
		setTimeout(() => m.sendSocketNotification("INIT_WEATHER", { instanceId: m.instanceId, weatherProvider: m.config.weatherProvider, ...m.config }), 400);
	},

	findModule (id) {
		return MM.getModules().find((m) => (m.data.classes || "").split(" ").includes(`sh-${id}`));
	},

	moduleVisible (id) {
		return this.placed.has(id);
	},

	/* ======================================================================
	 * Remote / keyboard
	 * ====================================================================== */

	focusChain: ["cog", "topbar", "hero", "rail"],

	routeFocus (dir, from) {
		const chain = this.focusChain;
		let i = chain.indexOf(from);
		if (i === -1) i = dir > 0 ? -1 : chain.length;
		for (let n = i + dir; n >= 0 && n < chain.length; n += dir) {
			const id = chain[n];
			const ok = id === "cog" ? true : this.moduleVisible(id === "rail" ? "apps" : id);
			if (!ok) continue;
			if (id === "cog") { this.showCog(); this.cog.focus(); }
			else this.sendNotification(`SH_FOCUS_${id.toUpperCase()}`);
			return;
		}
	},

	onKey (event) {
		if (this.learning && this.panel) {
			event.preventDefault(); event.stopPropagation();
			this.learnKey(event);
			return;
		}
		const action = window.SHRemote.actionFor(event);
		const dirKey = { up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight" }[action];

		if (this.pinDialog) {
			if (this.pinDialog.onKey(event, action)) { event.preventDefault(); event.stopPropagation(); return; }
			if (dirKey) {
				this.moveFocus(this.pinDialog, dirKey, 3);
				event.preventDefault(); event.stopPropagation();
			}
			return;
		}
		if (this.panel) {
			this.touchAdmin();
			const active = document.activeElement;
			const inInput = active && active.tagName === "INPUT" && active.type !== "color";
			if (inInput && !["up", "down"].includes(action) && !(action === "back" && event.key !== "Backspace")) return; // let typing through
			if (action === "back" || action === "settings" || action === "home") { this.closePanel(); if (action === "home") this.sendNotification("SH_HOME"); }
			else if (action === "up" || action === "down") { this.moveFocus(this.panel, dirKey); }
			else if (action === "left" || action === "right") {
				if (active && active.classList.contains("sh-nav")) this.moveFocus(this.panel.querySelector(".sh-panel-nav"), action === "left" ? "ArrowUp" : "ArrowDown");
				else if (active && active.stepLeft) (action === "left" ? active.stepLeft : active.stepRight)();
				else if (active && active.dataset.cycle) active.click();
				else this.moveFocus(this.panel, action === "left" ? "ArrowUp" : "ArrowDown");
			}
			else if (action === "select" && active && active.classList.contains("sh-focusable")) { active.click(); }
			else return;
			event.preventDefault(); event.stopPropagation();
			return;
		}
		// nothing of ours open
		if (action === "settings" && !document.body.classList.contains("sh-overlay-open")) {
			this.openSettings();
			event.preventDefault(); event.stopPropagation();
			return;
		}
		if (action === "home") {
			this.sendNotification("SH_HOME");
			return;
		}
		if (this.cog && document.activeElement === this.cog) {
			if (action === "select") { this.openSettings(); event.preventDefault(); }
			else if (action === "down" || action === "back") { this.cog.blur(); this.routeFocus(1, "cog"); event.preventDefault(); }
			event.stopPropagation();
		}
	},

	moveFocus (container, key, columns = 1) {
		const items = [...container.querySelectorAll(".sh-focusable")].filter((el) => el.offsetParent !== null && !el.disabled);
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

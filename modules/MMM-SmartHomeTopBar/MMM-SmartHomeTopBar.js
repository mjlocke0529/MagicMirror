/* MMM-SmartHomeTopBar - header strip
 * Greeting · Google search · quick links · weather chip · time.
 * Remote: ←/→ between items, Enter activates, ↓ to the hero/rail, ↑ to the cog.
 */
Module.register("MMM-SmartHomeTopBar", {
	defaults: {
		greeting: true,
		name: "", // e.g. "Locke family" -> "Good evening, Locke family"
		search: true,
		searchUrl: "https://www.google.com/search?q=",
		links: [
			{ name: "YouTube", url: "https://www.youtube.com/" },
			{ name: "Traffic", url: "https://www.google.com/maps/@47.2529,-122.4443,11z/data=!5m1!1e1" },
			{ name: "News", url: "https://news.google.com/" }
		],
		showWeather: true,
		showTime: true,
		weather: { lat: 47.25288, lon: -122.44429 },
		units: "imperial"
	},

	getStyles () {
		return ["MMM-SmartHomeTopBar.css"];
	},

	start () {
		this.focused = false;
		this.sel = 0;
		this.now = null;
		this.temp = null;
		document.addEventListener("keydown", (e) => this.onKey(e));
		setInterval(() => this.tick(), 1000);
		this.fetchWeather();
		setInterval(() => this.fetchWeather(), 15 * 60 * 1000);
	},

	notificationReceived (notification, payload) {
		if (notification === "SH_STATE" && payload) {
			if (payload.weather) this.config.weather = payload.weather;
			if (payload.general) this.config.units = payload.general.units;
			if (payload.topbar) Object.assign(this.config, payload.topbar);
			this.fetchWeather();
			this.updateDom(0);
		} else if (notification === "SH_FOCUS_TOPBAR") {
			this.setFocus(true);
		} else if (["SH_FOCUS_RAIL", "SH_FOCUS_HERO", "SH_FOCUS_COG", "SMARTHOME_APP_OPENED"].includes(notification)) {
			this.setFocus(false);
		}
	},

	async fetchWeather () {
		if (!this.config.showWeather || !this.config.weather) return;
		try {
			const unit = this.config.units === "metric" ? "celsius" : "fahrenheit";
			const url = `https://api.open-meteo.com/v1/forecast?latitude=${this.config.weather.lat}&longitude=${this.config.weather.lon}&current=temperature_2m,weather_code&temperature_unit=${unit}`;
			const data = await (await fetch(url)).json();
			this.temp = { value: Math.round(data.current.temperature_2m), code: data.current.weather_code, unit: unit === "celsius" ? "°C" : "°F" };
			const chip = document.querySelector(`#${this.identifier} .sh-tb-weather`);
			if (chip) chip.textContent = this.weatherText();
		} catch {
			// chip stays empty
		}
	},

	weatherText () {
		if (!this.temp) return "";
		const c = this.temp.code;
		const icon = c === 0 ? "☀️" : c <= 2 ? "🌤️" : c === 3 ? "☁️" : c <= 48 ? "🌫️" : c <= 67 ? "🌧️" : c <= 77 ? "🌨️" : c <= 82 ? "🌦️" : c <= 86 ? "🌨️" : "⛈️";
		return `${icon} ${this.temp.value}${this.temp.unit}`;
	},

	tick () {
		const el = document.querySelector(`#${this.identifier} .sh-tb-time`);
		if (el) el.textContent = this.timeText();
	},

	timeText () {
		const d = new Date();
		return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
	},

	greetingText () {
		const h = new Date().getHours();
		const g = h < 5 ? "Good night" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
		return this.config.name ? `${g}, ${this.config.name}` : g;
	},

	/* ---------- render ---------- */

	getDom () {
		const bar = document.createElement("div");
		bar.className = `sh-topbar${this.focused ? " focused" : ""}`;

		const left = document.createElement("div");
		left.className = "sh-tb-left";
		if (this.config.greeting) {
			const g = document.createElement("span");
			g.className = "sh-tb-greeting";
			g.textContent = this.greetingText();
			left.appendChild(g);
		}
		bar.appendChild(left);

		const mid = document.createElement("div");
		mid.className = "sh-tb-mid";
		if (this.config.search) {
			const form = document.createElement("form");
			form.className = "sh-tb-search sh-tb-item";
			form.innerHTML = `<span class="sh-tb-search-icon">🔍</span><input type="search" placeholder="Search Google…" aria-label="Search">`;
			const input = form.querySelector("input");
			form.addEventListener("submit", (e) => {
				e.preventDefault();
				const q = input.value.trim();
				if (!q) return;
				this.open("Google", `${this.config.searchUrl}${encodeURIComponent(q)}`);
				input.value = "";
				input.blur();
			});
			form.addEventListener("click", () => { this.selectItem(form); input.focus(); });
			mid.appendChild(form);
		}
		(this.config.links || []).forEach((link) => {
			const chip = document.createElement("button");
			chip.type = "button";
			chip.className = "sh-tb-link sh-tb-item";
			chip.textContent = link.name;
			chip.addEventListener("click", () => this.open(link.name, link.url));
			chip.addEventListener("mouseenter", () => this.selectItem(chip));
			mid.appendChild(chip);
		});
		bar.appendChild(mid);

		const right = document.createElement("div");
		right.className = "sh-tb-right";
		if (this.config.showWeather) {
			const w = document.createElement("span");
			w.className = "sh-tb-chip sh-tb-weather";
			w.textContent = this.weatherText();
			right.appendChild(w);
		}
		if (this.config.showTime) {
			const t = document.createElement("span");
			t.className = "sh-tb-chip sh-tb-time";
			t.textContent = this.timeText();
			right.appendChild(t);
		}
		bar.appendChild(right);

		this.applySelection(bar);
		return bar;
	},

	items () {
		return [...document.querySelectorAll(`#${this.identifier} .sh-tb-item`)];
	},

	selectItem (el) {
		const i = this.items().indexOf(el);
		if (i >= 0) { this.sel = i; this.applySelection(); }
	},

	applySelection (root) {
		const items = root ? [...root.querySelectorAll(".sh-tb-item")] : this.items();
		items.forEach((el, i) => el.classList.toggle("selected", this.focused && i === this.sel));
	},

	setFocus (on) {
		if (this.focused === on) return;
		this.focused = on;
		const bar = document.querySelector(`#${this.identifier} .sh-topbar`);
		if (bar) bar.classList.toggle("focused", on);
		if (!on) {
			const input = document.querySelector(`#${this.identifier} input`);
			if (input) input.blur();
		}
		this.applySelection();
	},

	open (name, url) {
		this.sendNotification("SH_OPEN_URL", { name, url });
	},

	/* ---------- remote ---------- */

	offScreen () {
		const el = document.getElementById(this.identifier);
		return !el || !!el.closest(".sh-parking");
	},

	shellBusy () {
		return ["sh-pin-open", "sh-panel-open", "sh-overlay-open"].some((c) => document.body.classList.contains(c));
	},

	onKey (event) {
		if (!this.focused || this.shellBusy() || this.hidden || this.offScreen()) return;
		const items = this.items();
		const active = document.activeElement;
		const typing = active && active.tagName === "INPUT";
		const action = window.SHRemote ? window.SHRemote.actionFor(event) : null;
		if (typing && !["down", "up"].includes(action) && !(action === "back" && event.key !== "Backspace")) return; // let the search box have the keys

		switch (action) {
			case "right": this.sel = Math.min(items.length - 1, this.sel + 1); this.applySelection(); break;
			case "left": this.sel = Math.max(0, this.sel - 1); this.applySelection(); break;
			case "select": {
				const el = items[this.sel];
				if (!el) return;
				if (el.classList.contains("sh-tb-search")) el.querySelector("input").focus();
				else el.click();
				break;
			}
			case "up": this.setFocus(false); this.sendNotification("SH_FOCUS_COG"); break;
			case "down": case "back":
				if (typing && action === "back") { active.blur(); }
				else { if (typing) active.blur(); this.setFocus(false); this.sendNotification("SH_FOCUS_DOWN", { from: "topbar" }); }
				break;
			default: return;
		}
		event.preventDefault();
		event.stopPropagation();
	}
});

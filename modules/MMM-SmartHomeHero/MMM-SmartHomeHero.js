/* MMM-SmartHomeHero - trending titles slider
 * Full-width backdrop that cross-fades through popular titles on the
 * streaming services in the app rail. ↑ from the rail focuses it; ←/→ step,
 * Enter opens that service's search for the title in the app overlay.
 * Data from TMDB (https://www.themoviedb.org), not endorsed or certified by TMDB.
 */
Module.register("MMM-SmartHomeHero", {
	defaults: {
		tmdbApiKey: "",
		services: "auto", // "auto" = derive from the app rail, or e.g. ["netflix", "disneyplus"]
		types: ["movie", "tv"],
		region: "US",
		perService: 8,
		interval: 10 * 1000, // slide every 10s
		refresh: 6 * 60 * 60 * 1000, // re-fetch every 6h
		apps: []
	},

	getStyles () {
		return ["MMM-SmartHomeHero.css"];
	},

	start () {
		this.items = [];
		this.index = 0;
		this.focused = false;
		this.error = null;
		this.apps = this.config.apps || [];
		document.addEventListener("keydown", (e) => this.onKey(e));
		this.fetch();
		setInterval(() => this.fetch(), this.config.refresh);
		this.startSlider();
	},

	startSlider () {
		clearInterval(this.timer);
		this.timer = setInterval(() => { if (!this.focused && !this.overlayOpen()) this.step(1); }, this.config.interval);
	},

	// live settings change from the shell (types, interval, key saved server-side)
	reconfigure (hero) {
		Object.assign(this.config, { types: hero.types, interval: hero.interval, region: hero.region || this.config.region });
		this.startSlider();
		this.fetch();
	},

	servicesFromApps () {
		const map = [["netflix", "netflix"], ["disneyplus", "disneyplus"], ["amazon", "prime"], ["primevideo", "prime"], ["hulu", "hulu"], ["max.com", "max"], ["tv.apple", "appletv"], ["peacocktv", "peacock"], ["paramountplus", "paramount"]];
		const out = new Set();
		for (const app of this.apps) {
			if (app.hidden) continue;
			const host = (app.url || "").toLowerCase();
			for (const [needle, id] of map) if (host.includes(needle)) out.add(id);
		}
		return [...out];
	},

	fetch () {
		const services = Array.isArray(this.config.services) ? this.config.services : this.servicesFromApps();
		this.sendSocketNotification("HERO_FETCH", {
			services,
			region: this.config.region,
			types: this.config.types,
			perService: this.config.perService,
			ttl: this.config.refresh
		});
	},

	socketNotificationReceived (notification, payload) {
		if (notification !== "HERO_DATA") return;
		this.error = payload.error || null;
		if (payload.items && payload.items.length) {
			this.items = payload.items;
			this.index = Math.min(this.index, this.items.length - 1);
			this.items.slice(0, 3).forEach((it) => { new Image().src = it.backdrop; });
		}
		this.updateDom(0);
	},

	notificationReceived (notification, payload) {
		if (notification === "SH_STATE" && payload && Array.isArray(payload.apps)) {
			this.apps = payload.apps;
			this.fetch();
		} else if (notification === "SH_HERO_CONFIG" && payload) {
			this.reconfigure(payload);
		} else if (notification === "SH_FOCUS_HERO") {
			this.setFocus(true);
		} else if (notification === "SMARTHOME_APP_OPENED" || notification === "SH_FOCUS_RAIL" || notification === "SH_FOCUS_COG") {
			this.setFocus(false);
		}
	},

	/* ---------- render ---------- */

	getDom () {
		const hero = document.createElement("div");
		hero.className = `sh-hero${this.focused ? " focused" : ""}`;

		if (!this.items.length) {
			hero.classList.add("empty");
			hero.innerHTML = `<div class="sh-hero-empty dimmed">${this.error ? this.escape(this.error) : "Loading what's trending…"}</div>`;
			return hero;
		}

		const item = this.items[this.index];
		const bg = document.createElement("div");
		bg.className = "sh-hero-bg";
		bg.style.backgroundImage = `url("${item.backdrop}")`;
		hero.appendChild(bg);

		const shade = document.createElement("div");
		shade.className = "sh-hero-shade";
		hero.appendChild(shade);

		const meta = document.createElement("div");
		meta.className = "sh-hero-meta";
		meta.innerHTML = `
			<div class="sh-hero-chips"><span class="sh-hero-chip service-${item.service}">${this.escape(item.serviceLabel)}</span>${item.year ? `<span class="sh-hero-chip">${item.year}</span>` : ""}${item.rating ? `<span class="sh-hero-chip">★ ${item.rating}</span>` : ""}<span class="sh-hero-chip">${item.type === "tv" ? "Series" : "Movie"}</span></div>
			<div class="sh-hero-title">${this.escape(item.title)}</div>
			<div class="sh-hero-overview">${this.escape(item.overview || "")}</div>
			<div class="sh-hero-hint">${this.focused ? "← → browse · Enter to open · ↓ back to apps" : ""}</div>`;
		hero.appendChild(meta);

		const dots = document.createElement("div");
		dots.className = "sh-hero-dots";
		this.items.forEach((_, i) => {
			const d = document.createElement("span");
			d.className = i === this.index ? "on" : "";
			dots.appendChild(d);
		});
		hero.appendChild(dots);

		hero.addEventListener("click", () => this.open());
		hero.addEventListener("mouseenter", () => this.setFocus(true));
		hero.addEventListener("mouseleave", () => this.setFocus(false));

		const next = this.items[(this.index + 1) % this.items.length];
		if (next) new Image().src = next.backdrop;
		return hero;
	},

	escape (s) {
		return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]));
	},

	step (dir) {
		if (!this.items.length) return;
		this.index = (this.index + dir + this.items.length) % this.items.length;
		this.updateDom(600);
	},

	setFocus (on) {
		if (this.focused === on) return;
		this.focused = on;
		const el = document.querySelector(`#${this.identifier} .sh-hero`);
		if (el) {
			el.classList.toggle("focused", on);
			const hint = el.querySelector(".sh-hero-hint");
			if (hint) hint.textContent = on ? "← → browse · Enter to open · ↓ back to apps" : "";
		}
	},

	open () {
		const item = this.items[this.index];
		if (!item) return;
		this.sendNotification("SH_OPEN_URL", { name: item.serviceLabel, url: item.url, title: item.title });
	},

	/* ---------- remote ---------- */

	overlayOpen () {
		return document.body.classList.contains("sh-overlay-open");
	},

	shellBusy () {
		return document.body.classList.contains("sh-pin-open") || document.body.classList.contains("sh-panel-open") || this.overlayOpen();
	},

	onKey (event) {
		if (!this.focused || this.shellBusy() || this.hidden) return;
		switch (event.key) {
			case "ArrowRight": this.step(1); break;
			case "ArrowLeft": this.step(-1); break;
			case "Enter": this.open(); break;
			case "ArrowUp": this.setFocus(false); this.sendNotification("SH_FOCUS_UP", { from: "hero" }); break;
			case "ArrowDown": case "Escape": case "BrowserBack": this.setFocus(false); this.sendNotification("SH_FOCUS_RAIL"); break;
			default: return;
		}
		event.preventDefault();
		event.stopPropagation();
	}
});

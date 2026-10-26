const path = require("node:path");
const NodeHelper = require("node_helper");
const Log = require("logger");
const { loadSmartHome, saveSmartHome, POSITIONS } = require("./lib/config-builder");

const JSON_PATH = path.resolve(__dirname, "..", "..", "config", "smarthome.json");

module.exports = NodeHelper.create({
	start () {
		Log.log(`[${this.name}] helper started, settings at ${JSON_PATH}`);
	},

	load () {
		return loadSmartHome(JSON_PATH);
	},

	save (data) {
		saveSmartHome(JSON_PATH, data);
	},

	checkPin (pin) {
		const data = this.load();
		return typeof pin === "string" && pin.length > 0 && pin === String(data.adminPin);
	},

	/** Everything the renderer needs, minus the PIN itself. */
	publicState () {
		const data = this.load();
		const { adminPin, ...rest } = data;
		rest.hero = { ...rest.hero, tmdbApiKey: rest.hero && rest.hero.tmdbApiKey ? "set" : "" };
		return { ...rest, positions: POSITIONS };
	},

	broadcast () {
		this.sendSocketNotification("SH_STATE", this.publicState());
	},

	socketNotificationReceived (notification, payload) {
		switch (notification) {
			case "SH_INIT":
				this.broadcast();
				break;

			case "SH_VERIFY_PIN":
				this.sendSocketNotification("SH_PIN_RESULT", { ok: this.checkPin(payload.pin), token: payload.token });
				break;

			case "SH_UPDATE": // { pin, patch: { apps?, modules?, weather?, general? }, relaunch? }
				this.update(payload);
				break;

			case "SH_SET_WEATHER":
				if (!this.checkPin(payload.pin)) return;
				this.setWeather(payload.query);
				break;

			case "SH_CHANGE_PIN":
				if (!this.checkPin(payload.pin)) return this.sendSocketNotification("SH_TOAST", { ok: false, message: "Current PIN is wrong" });
				if (!/^\d{4,8}$/.test(payload.newPin)) return this.sendSocketNotification("SH_TOAST", { ok: false, message: "PIN must be 4-8 digits" });
				this.save({ ...this.load(), adminPin: payload.newPin });
				this.sendSocketNotification("SH_TOAST", { ok: true, message: "PIN changed" });
				break;

			case "SH_RELAUNCH":
				if (!this.checkPin(payload.pin)) return;
				this.relaunch();
				break;
		}
	},

	update ({ pin, patch, relaunch }) {
		if (!this.checkPin(pin)) {
			Log.warn(`[${this.name}] update rejected: bad PIN`);
			return;
		}
		const data = this.load();
		const allowed = ["apps", "modules", "weather", "general", "hero"];
		for (const key of Object.keys(patch || {})) {
			if (!allowed.includes(key)) continue;
			if (key === "hero") {
				const hero = { ...data.hero, ...patch.hero };
				if (!patch.hero.tmdbApiKey) hero.tmdbApiKey = data.hero.tmdbApiKey; // keep existing key unless a new one is given
				data.hero = hero;
			} else {
				data[key] = patch[key];
			}
		}
		try {
			this.save(data);
		} catch (error) {
			Log.error(`[${this.name}] could not save settings: ${error.message}`);
			this.sendSocketNotification("SH_TOAST", { ok: false, message: `Save failed: ${error.message}` });
			return;
		}
		this.broadcast();
		if (relaunch) {
			this.sendSocketNotification("SH_TOAST", { ok: true, message: "Saved. Restarting…" });
			setTimeout(() => this.relaunch(), 1200);
		}
	},

	async setWeather (query) {
		try {
			const url = `https://geocoding-api.open-meteo.com/v1/search?count=1&language=en&format=json&name=${encodeURIComponent(query)}`;
			const res = await fetch(url);
			const json = await res.json();
			const hit = json.results && json.results[0];
			if (!hit) return this.sendSocketNotification("SH_TOAST", { ok: false, message: `No match for "${query}"` });
			const label = [hit.name, hit.admin1, hit.country_code].filter(Boolean).join(", ");
			const data = this.load();
			data.weather = { label, lat: hit.latitude, lon: hit.longitude };
			this.save(data);
			this.broadcast();
			this.sendSocketNotification("SH_TOAST", { ok: true, message: `Weather set to ${label}. Restarting…` });
			setTimeout(() => this.relaunch(), 1200);
		} catch (error) {
			this.sendSocketNotification("SH_TOAST", { ok: false, message: error.message });
		}
	},

	relaunch () {
		try {
			const { app } = require("electron");
			if (app && app.relaunch) {
				Log.log(`[${this.name}] relaunching`);
				app.relaunch();
				app.exit(0);
				return;
			}
		} catch {
			// not running under Electron
		}
		Log.warn(`[${this.name}] cannot relaunch automatically; restart MagicMirror to apply changes`);
		this.sendSocketNotification("SH_TOAST", { ok: false, message: "Restart MagicMirror to apply" });
	}
});

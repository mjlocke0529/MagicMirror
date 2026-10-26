const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { execFile } = require("node:child_process");
const NodeHelper = require("node_helper");
const Log = require("logger");

const STATE_FILE = path.join(__dirname, "state.json");

module.exports = NodeHelper.create({
	start () {
		Log.log(`[${this.name}] helper started`);
		this.adminPin = null;
	},

	socketNotificationReceived (notification, payload) {
		switch (notification) {
			case "SMARTHOME_INIT":
				this.adminPin = String(payload.adminPin ?? "0000");
				if (this.adminPin === "0000") Log.warn(`[${this.name}] adminPin is the default "0000" - set adminPin in config.js`);
				this.sendState();
				break;
			case "SMARTHOME_VERIFY_PIN":
				this.sendSocketNotification("SMARTHOME_PIN_RESULT", { ok: this.checkPin(payload.pin), purpose: payload.purpose, app: payload.app });
				break;
			case "SMARTHOME_SAVE_STATE":
				if (!this.checkPin(payload.pin)) {
					Log.warn(`[${this.name}] state save rejected: bad PIN`);
					return;
				}
				this.writeState({ overrides: payload.overrides || {}, customApps: payload.customApps || [] });
				this.sendState();
				break;
			case "SMARTHOME_OPEN_APP":
				this.openApp(payload);
				break;
		}
	},

	checkPin (pin) {
		return typeof pin === "string" && pin.length > 0 && pin === this.adminPin;
	},

	/* ---------- persisted state: { overrides: { [appName]: { hidden, locked } }, customApps: [...] } ---------- */

	readState () {
		try {
			return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
		} catch {
			return { overrides: {}, customApps: [] };
		}
	},

	writeState (state) {
		try {
			fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
		} catch (error) {
			Log.error(`[${this.name}] could not write ${STATE_FILE}: ${error.message}`);
		}
	},

	sendState () {
		this.sendSocketNotification("SMARTHOME_STATE", this.readState());
	},

	/* ---------- external browser mode ---------- */

	openApp ({ name, url, browser, kiosk }) {
		let cmd;
		let args;

		if (process.platform === "darwin") {
			if (!browser || browser === "default") {
				cmd = "open";
				args = [url];
			} else {
				const profileDir = path.join(os.homedir(), "Library", "Application Support", "MagicMirror-SmartHomeApps");
				cmd = "open";
				args = ["-na", browser, "--args", `--user-data-dir=${profileDir}`, "--no-first-run", "--no-default-browser-check", `--app=${url}`];
				if (kiosk) args.push("--kiosk", "--start-fullscreen");
			}
		} else if (process.platform === "linux") {
			cmd = "xdg-open";
			args = [url];
		} else {
			cmd = "cmd";
			args = ["/c", "start", "", url];
		}

		Log.log(`[${this.name}] opening ${name}: ${cmd} ${args.join(" ")}`);
		execFile(cmd, args, (error) => {
			if (error) Log.error(`[${this.name}] failed to open ${name}: ${error.message}`);
			this.sendSocketNotification("SMARTHOME_OPEN_APP_RESULT", { name, ok: !error, error: error ? error.message : null });
		});
	}
});

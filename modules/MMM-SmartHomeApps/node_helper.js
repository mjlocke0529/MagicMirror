const path = require("node:path");
const os = require("node:os");
const { execFile } = require("node:child_process");
const NodeHelper = require("node_helper");
const Log = require("logger");

/* External-browser fallback: launch an app URL in a real browser (mode: "external"). */
module.exports = NodeHelper.create({
	socketNotificationReceived (notification, payload) {
		if (notification === "SMARTHOME_OPEN_APP") this.openApp(payload);
		if (notification === "SMARTHOME_GUEST_LOG") Log.log(`[guest] ${payload}`);
	},

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

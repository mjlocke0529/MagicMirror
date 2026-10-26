/* MMM-SmartHomeApps
 * App launcher tiles for the SmartHome dashboard.
 * Clicking a tile asks the node_helper to open the app's URL in a real browser
 * (streaming services need Widevine DRM, which Electron doesn't ship).
 */
Module.register("MMM-SmartHomeApps", {
	defaults: {
		title: "Apps",
		browser: "Google Chrome", // macOS app name; set to "default" to use the system default browser
		kiosk: true, // open in a fullscreen, chrome-less window
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
	},

	getDom () {
		const wrapper = document.createElement("div");
		wrapper.className = "smarthome-apps";

		this.config.apps.forEach((app, index) => {
			const tile = document.createElement("button");
			tile.className = "smarthome-app-tile";
			tile.type = "button";
			tile.tabIndex = 0;
			tile.style.setProperty("--tile-color", app.color || "#333");
			tile.dataset.index = index;

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
		this.sendSocketNotification("SMARTHOME_OPEN_APP", {
			name: app.name,
			url: app.url,
			browser: this.config.browser,
			kiosk: this.config.kiosk
		});
	},

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

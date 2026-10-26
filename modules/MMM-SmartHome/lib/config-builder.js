/* SmartHome config builder
 * Reads config/smarthome.json (the single source of truth for the dashboard)
 * and produces a MagicMirror config object. Used by config/config.js at
 * startup and by the MMM-SmartHome node_helper when settings change.
 */
const fs = require("node:fs");
const path = require("node:path");

const POSITIONS = ["top_bar", "top_left", "top_center", "top_right", "upper_third", "middle_center", "lower_third", "bottom_left", "bottom_center", "bottom_right", "bottom_bar"];

const DEFAULTS = {
	version: 1,
	adminPin: "1234",
	general: { language: "en", locale: "en-US", timeFormat: 12, units: "imperial" },
	weather: { label: "Gig Harbor, WA", lat: 47.3295, lon: -122.5801 },
	apps: [
		{ name: "Netflix", url: "https://www.netflix.com/browse", color: "#e50914", hidden: false, locked: false },
		{ name: "Disney+", url: "https://www.disneyplus.com/home", color: "#0f3fa3", hidden: false, locked: false }
	],
	modules: [
		{ id: "apps", name: "Apps", module: "MMM-SmartHomeApps", position: "middle_center", enabled: true },
		{ id: "clock", name: "Clock", module: "clock", position: "top_left", enabled: true },
		{
			id: "calendar", name: "Calendar", module: "calendar", position: "top_left", enabled: true, header: "US Holidays",
			config: { calendars: [{ fetchInterval: 7 * 24 * 60 * 60 * 1000, symbol: "calendar-check", url: "https://ics.calendarlabs.com/76/mm3137/US_Holidays.ics" }] }
		},
		{ id: "weather-current", name: "Weather (current)", module: "weather", position: "top_right", enabled: true, config: { weatherProvider: "openmeteo", type: "current" } },
		{ id: "weather-forecast", name: "Weather (forecast)", module: "weather", position: "top_right", enabled: true, header: "Weather Forecast", config: { weatherProvider: "openmeteo", type: "forecast" } },
		{
			id: "news", name: "News", module: "newsfeed", position: "bottom_bar", enabled: true,
			config: { feeds: [{ title: "New York Times", url: "https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml" }], showSourceTitle: true, showPublishDate: true, broadcastNewsFeeds: true, broadcastNewsUpdates: true }
		},
		{ id: "compliments", name: "Compliments", module: "compliments", position: "lower_third", enabled: false }
	]
};

const clone = (obj) => JSON.parse(JSON.stringify(obj));

/** Read smarthome.json, creating it from defaults when missing. */
const loadSmartHome = (jsonPath) => {
	let data;
	try {
		data = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
	} catch {
		data = clone(DEFAULTS);
		try {
			fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
			fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2));
		} catch {
			// read-only location: carry on with in-memory defaults
		}
	}
	// fill in anything missing from defaults (shallow for sections, keyed for modules)
	const merged = { ...clone(DEFAULTS), ...data };
	merged.general = { ...DEFAULTS.general, ...(data.general || {}) };
	merged.weather = { ...DEFAULTS.weather, ...(data.weather || {}) };
	if (!Array.isArray(merged.modules) || merged.modules.length === 0) merged.modules = clone(DEFAULTS.modules);
	if (!merged.modules.some((m) => m.id === "apps")) merged.modules.unshift(clone(DEFAULTS.modules[0]));
	return merged;
};

const saveSmartHome = (jsonPath, data) => {
	fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2));
};

/** Turn smarthome.json data into a MagicMirror config object. */
const buildConfig = (sh) => {
	const modules = [
		{ module: "alert" },
		{ module: "updatenotification", position: "top_bar" },
		{ module: "MMM-SmartHome", position: "fullscreen_above", classes: "sh-core", config: { adminPin: String(sh.adminPin) } }
	];

	for (const entry of sh.modules) {
		if (!entry.module) continue;
		const position = POSITIONS.includes(entry.position) ? entry.position : "middle_center";
		const config = clone(entry.config || {});
		if (entry.module === "weather") {
			config.lat = sh.weather.lat;
			config.lon = sh.weather.lon;
		}
		if (entry.module === "MMM-SmartHomeApps") {
			config.apps = clone(sh.apps);
		}
		modules.push({
			module: entry.module,
			position,
			header: entry.header,
			classes: `sh-${entry.id}`,
			disabled: entry.enabled === false,
			config
		});
	}

	return {
		address: "localhost",
		port: 8080,
		basePath: "/",
		ipWhitelist: ["127.0.0.1", "::ffff:127.0.0.1", "::1"],
		useHttps: false,
		language: sh.general.language,
		locale: sh.general.locale,
		logLevel: ["INFO", "LOG", "WARN", "ERROR"],
		timeFormat: sh.general.timeFormat,
		units: sh.general.units,
		modules
	};
};

module.exports = { DEFAULTS, POSITIONS, loadSmartHome, saveSmartHome, buildConfig };

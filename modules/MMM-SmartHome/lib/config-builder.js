/* SmartHome config builder
 * Reads config/smarthome.json (the single source of truth for the dashboard)
 * and produces a MagicMirror config object. Used by config/config.js at
 * startup and by the MMM-SmartHome node_helper when settings change.
 *
 * Layout model (same shape as design/layout-designer.html):
 *   layout.topbar            true/false
 *   layout.sections[]        { id: upper|middle|lower, enabled, size: 1|2 (thirds), split, slots[] }
 *   layout.bottombar         { enabled, slots[] }
 * A module is on screen when its id sits in a slot; everything else loads but stays hidden.
 */
const fs = require("node:fs");
const path = require("node:path");

const SPLITS = { "1": [1], "2": [1, 1], "3": [1, 1, 1], "1-2": [1, 2], "2-1": [2, 1] };

const DEFAULTS = {
	version: 2,
	adminPin: "1234",
	general: { language: "en", locale: "en-US", timeFormat: 12, units: "imperial", adminLock: false },
	weather: { label: "Tacoma, WA", lat: 47.25288, lon: -122.44429 },
	hero: { tmdbApiKey: "", types: ["movie", "tv"], interval: 10000, region: "US" },
	appearance: { theme: "tiles", accent: "#ffffff" },
	// Remote / keyboard mapping: action -> list of event.key or event.code values
	remote: {
		back: ["Escape", "BrowserBack", "Backspace", "GoBack"],
		home: ["Home", "BrowserHome"],
		settings: ["ContextMenu", "F1", "BrowserSearch", "Menu", "LaunchApplication1"],
		select: ["Enter"],
		up: ["ArrowUp"], down: ["ArrowDown"], left: ["ArrowLeft"], right: ["ArrowRight"],
		playpause: ["MediaPlayPause", "MediaPlay", "MediaPause"]
	},
	topbar: {
		greeting: true, name: "", search: true, showWeather: true, showTime: true,
		links: [
			{ name: "YouTube", url: "https://www.youtube.com/" },
			{ name: "Traffic", url: "https://www.google.com/maps/@47.2529,-122.4443,11z/data=!5m1!1e1" },
			{ name: "News", url: "https://news.google.com/" }
		]
	},
	apps: [
		{ name: "Netflix", url: "https://www.netflix.com/browse", color: "#e50914", hidden: false, locked: false },
		{ name: "Disney+", url: "https://www.disneyplus.com/home", color: "#0f3fa3", hidden: false, locked: false }
	],
	layout: {
		topbar: true,
		sections: [
			{ id: "upper", enabled: true, size: 2, split: "1", slots: ["hero"] },
			{ id: "middle", enabled: true, size: 1, split: "1", slots: ["apps"] },
			{ id: "lower", enabled: false, size: 1, split: "3", slots: ["clock", "weather", "calendar"] }
		],
		bottombar: { enabled: true, slots: ["news"] }
	},
	// Every module that exists, keyed by the id used in layout slots.
	modules: [
		{ id: "topbar", name: "Top bar", module: "MMM-SmartHomeTopBar" },
		{ id: "hero", name: "Trending hero", module: "MMM-SmartHomeHero" },
		{ id: "apps", name: "App rail", module: "MMM-SmartHomeApps" },
		{ id: "clock", name: "Clock", module: "clock" },
		{
			id: "calendar", name: "Calendar", module: "calendar", header: "Calendar",
			config: { calendars: [{ fetchInterval: 7 * 24 * 60 * 60 * 1000, symbol: "calendar-check", url: "https://ics.calendarlabs.com/76/mm3137/US_Holidays.ics" }] }
		},
		{ id: "weather", name: "Weather now", module: "weather", config: { weatherProvider: "openmeteo", type: "current" } },
		{ id: "forecast", name: "Forecast", module: "weather", header: "Forecast", config: { weatherProvider: "openmeteo", type: "forecast" } },
		{
			id: "news", name: "News", module: "newsfeed",
			config: { feeds: [{ title: "New York Times", url: "https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml" }], showSourceTitle: true, showPublishDate: true, broadcastNewsFeeds: true, broadcastNewsUpdates: true }
		},
		{ id: "compliments", name: "Compliments", module: "compliments" }
	]
};

const clone = (obj) => JSON.parse(JSON.stringify(obj));

/** Map the pre-layout (v1) module list onto the layout model. */
const migrateV1 = (data) => {
	const out = { ...data };
	const oldModules = Array.isArray(data.modules) ? data.modules : [];
	const idMap = { "weather-current": "weather", "weather-forecast": "forecast" };
	const layout = clone(DEFAULTS.layout);
	const placed = new Set();
	const slotFor = { upper_third: ["upper", 0], middle_center: ["middle", 0], lower_third: ["lower", 0], bottom_bar: ["bottombar", 0] };
	layout.sections.forEach((s) => { s.slots = []; s.enabled = false; });
	layout.bottombar = { enabled: false, slots: [] };
	for (const m of oldModules) {
		const id = idMap[m.id] || m.id;
		if (m.enabled === false) continue;
		if (id === "topbar") { layout.topbar = true; continue; }
		const target = slotFor[m.position];
		if (target) {
			const sec = target[0] === "bottombar" ? layout.bottombar : layout.sections.find((s) => s.id === target[0]);
			sec.enabled = true;
			sec.slots.push(id);
			placed.add(id);
		} else if (!placed.has(id)) {
			// top_* / bottom_* positions: fold into the lower third
			const sec = layout.sections.find((s) => s.id === "lower");
			sec.enabled = true;
			sec.slots.push(id);
			placed.add(id);
		}
	}
	for (const s of layout.sections) {
		if (s.slots.length === 0) { s.slots = clone(DEFAULTS.layout.sections.find((d) => d.id === s.id).slots); continue; }
		s.split = s.slots.length >= 3 ? "3" : s.slots.length === 2 ? "2" : "1";
		s.slots = s.slots.slice(0, 3);
		if (s.id === "upper" && s.slots[0] === "hero") s.size = 2;
	}
	if (layout.bottombar.slots.length === 0) layout.bottombar.slots = ["news"];
	out.layout = layout;
	out.modules = clone(DEFAULTS.modules).map((def) => {
		const old = oldModules.find((m) => (idMap[m.id] || m.id) === def.id);
		return old ? { ...def, header: old.header !== undefined ? old.header : def.header, config: old.config || def.config } : def;
	});
	out.version = 2;
	return out;
};

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
	if (!data.layout && Array.isArray(data.modules) && data.modules.some((m) => m.position)) {
		data = migrateV1(data);
		try { fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2)); } catch { /* ignore */ }
	}
	const merged = { ...clone(DEFAULTS), ...data };
	for (const key of ["general", "weather", "hero", "appearance", "topbar", "remote"]) merged[key] = { ...DEFAULTS[key], ...(data[key] || {}) };
	merged.layout = { ...clone(DEFAULTS.layout), ...(data.layout || {}) };
	if (!Array.isArray(merged.layout.sections) || merged.layout.sections.length === 0) merged.layout.sections = clone(DEFAULTS.layout.sections);
	if (!merged.layout.bottombar) merged.layout.bottombar = clone(DEFAULTS.layout.bottombar);
	if (!Array.isArray(merged.modules) || merged.modules.length === 0) merged.modules = clone(DEFAULTS.modules);
	for (const def of DEFAULTS.modules) {
		if (!merged.modules.some((m) => m.id === def.id)) merged.modules.push(clone(def));
	}
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
		const config = clone(entry.config || {});
		if (entry.module === "weather") {
			config.lat = sh.weather.lat;
			config.lon = sh.weather.lon;
		}
		if (entry.module === "MMM-SmartHomeApps") config.apps = clone(sh.apps);
		if (entry.module === "MMM-SmartHomeTopBar") Object.assign(config, clone(sh.topbar), { weather: clone(sh.weather), units: sh.general.units });
		if (entry.module === "MMM-SmartHomeHero") {
			const { tmdbApiKey, ...hero } = sh.hero; // the key stays in the helper
			Object.assign(config, clone(hero), { apps: clone(sh.apps) });
		}
		// All modules load into a hidden region; the shell moves them into its grid.
		modules.push({ module: entry.module, position: "fullscreen_below", header: entry.header, classes: `sh-mod sh-${entry.id}`, config });
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

module.exports = { DEFAULTS, SPLITS, loadSmartHome, saveSmartHome, buildConfig };

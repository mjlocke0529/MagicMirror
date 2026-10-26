/* Quick TMDB check: node modules/MMM-SmartHomeHero/check.js */
const fs = require("node:fs");
const path = require("node:path");
const settings = JSON.parse(fs.readFileSync(path.resolve(__dirname, "..", "..", "config", "smarthome.json"), "utf8"));
const key = (settings.hero || {}).tmdbApiKey || "";
console.log("API key:", key ? `${key.slice(0, 4)}… (${key.length} chars)` : "MISSING");
(async () => {
	for (const [label, id, type] of [["Netflix", 8, "tv"], ["Disney+", 337, "movie"]]) {
		const url = `https://api.themoviedb.org/3/discover/${type}?api_key=${key}&language=en-US&watch_region=US&with_watch_providers=${id}&with_watch_monetization_types=flatrate&sort_by=popularity.desc&include_adult=false&page=1`;
		try {
			const res = await fetch(url);
			const data = await res.json();
			console.log(`\n${label} ${type}: HTTP ${res.status}${data.status_message ? ` - ${data.status_message}` : ""}`);
			(data.results || []).slice(0, 5).forEach((r) => console.log("  -", r.title || r.name, (r.release_date || r.first_air_date || "").slice(0, 4), r.backdrop_path ? "backdrop ok" : "NO BACKDROP"));
		} catch (error) {
			console.log(`\n${label} ${type}: FAILED - ${error.message}`);
		}
	}
})();

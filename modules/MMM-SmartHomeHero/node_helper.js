/* MMM-SmartHomeHero helper - fetches trending titles from TMDB filtered by
 * streaming provider (Netflix, Disney+, ...) and returns them with backdrops.
 * Data: https://www.themoviedb.org  (this product uses the TMDB API but is not endorsed or certified by TMDB)
 */
const fs = require("node:fs");
const path = require("node:path");
const NodeHelper = require("node_helper");
const Log = require("logger");

const SETTINGS = path.resolve(__dirname, "..", "..", "config", "smarthome.json");
const readApiKey = () => {
	try {
		return (JSON.parse(fs.readFileSync(SETTINGS, "utf8")).hero || {}).tmdbApiKey || "";
	} catch {
		return "";
	}
};

const TMDB = "https://api.themoviedb.org/3";
const IMG = "https://image.tmdb.org/t/p";

// TMDB watch-provider ids (US)
const PROVIDERS = {
	netflix: { id: 8, label: "Netflix", search: (q) => `https://www.netflix.com/search?q=${encodeURIComponent(q)}` },
	disneyplus: { id: 337, label: "Disney+", search: (q) => `https://www.disneyplus.com/search?q=${encodeURIComponent(q)}` },
	prime: { id: 9, label: "Prime Video", search: (q) => `https://www.amazon.com/s?k=${encodeURIComponent(q)}&i=instant-video` },
	hulu: { id: 15, label: "Hulu", search: (q) => `https://www.hulu.com/search?q=${encodeURIComponent(q)}` },
	max: { id: 1899, label: "Max", search: (q) => `https://play.max.com/search/result?q=${encodeURIComponent(q)}` },
	appletv: { id: 350, label: "Apple TV+", search: (q) => `https://tv.apple.com/search?term=${encodeURIComponent(q)}` },
	peacock: { id: 386, label: "Peacock", search: (q) => `https://www.peacocktv.com/search?q=${encodeURIComponent(q)}` },
	paramount: { id: 531, label: "Paramount+", search: (q) => `https://www.paramountplus.com/search/?q=${encodeURIComponent(q)}` }
};

module.exports = NodeHelper.create({
	start () {
		this.cache = { key: null, at: 0, items: [] };
	},

	socketNotificationReceived (notification, payload) {
		if (notification === "HERO_FETCH") this.fetchAll(payload);
	},

	async fetchAll ({ services, region, types, perService, ttl }) {
		const apiKey = readApiKey();
		if (!apiKey) {
			this.sendSocketNotification("HERO_DATA", { error: "No TMDB API key set (Settings → Hero)" });
			return;
		}
		const cacheKey = JSON.stringify({ services, region, types, perService, apiKey });
		if (this.cache.key === cacheKey && Date.now() - this.cache.at < ttl) {
			this.sendSocketNotification("HERO_DATA", { items: this.cache.items });
			return;
		}

		const items = [];
		try {
			for (const serviceId of services) {
				const provider = PROVIDERS[serviceId];
				if (!provider) continue;
				for (const type of types) {
					const url = `${TMDB}/discover/${type}?api_key=${apiKey}&language=en-US&watch_region=${region}&with_watch_providers=${provider.id}&with_watch_monetization_types=flatrate&sort_by=popularity.desc&include_adult=false&page=1`;
					const res = await fetch(url);
					if (!res.ok) throw new Error(`TMDB ${res.status} for ${provider.label} ${type}`);
					const data = await res.json();
					for (const r of (data.results || []).slice(0, perService)) {
						if (!r.backdrop_path) continue;
						const title = r.title || r.name;
						items.push({
							id: `${type}-${r.id}`,
							type,
							title,
							year: (r.release_date || r.first_air_date || "").slice(0, 4),
							overview: r.overview,
							rating: r.vote_average ? Math.round(r.vote_average * 10) / 10 : null,
							backdrop: `${IMG}/w1280${r.backdrop_path}`,
							service: serviceId,
							serviceLabel: provider.label,
							url: provider.search(title)
						});
					}
				}
			}
			// interleave services so the slider alternates instead of batching
			const byService = {};
			for (const it of items) (byService[it.service] ||= []).push(it);
			const mixed = [];
			const lists = Object.values(byService);
			for (let i = 0; lists.some((l) => l.length > i); i++) for (const l of lists) if (l[i]) mixed.push(l[i]);

			this.cache = { key: cacheKey, at: Date.now(), items: mixed };
			this.sendSocketNotification("HERO_DATA", { items: mixed });
		} catch (error) {
			Log.error(`[${this.name}] ${error.message}`);
			this.sendSocketNotification("HERO_DATA", { error: error.message, items: this.cache.items });
		}
	}
});

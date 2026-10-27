/* SmartHome guest script - injected into streaming pages (Netflix, Disney+, ...)
 * Gives mouse-first websites a TV remote feel:
 *  - spatial navigation: arrows move a highlight between clickable elements, Select clicks
 *  - video mode: when a video is playing, left/right seek, select = play/pause, up/down reveal controls
 *  - back / home / settings / play-pause reported to the shell (see MMM-SmartHomeApps)
 * The shell prepends `const MAP = {...}` (the remote mapping) before this file.
 */
(() => {
	if (window.__smarthomeHook) return;
	window.__smarthomeHook = true;

	const actionFor = (e) => { for (const [a, ks] of Object.entries(MAP)) if (ks.includes(e.key) || ks.includes(e.code)) return a; return null; };
	const SEL = "a[href], button, [role=button], [role=link], [role=option], [role=menuitem], [role=tab], [role=checkbox], [role=switch], input:not([type=hidden]), select, textarea, [tabindex]:not([tabindex='-1']), video";
	const style = document.createElement("style");
	style.textContent = `.__sh-focus{outline:4px solid #fff !important;outline-offset:3px !important;border-radius:6px;box-shadow:0 0 0 2px rgba(0,0,0,.6),0 0 24px rgba(255,255,255,.5) !important;transition:none !important}`;
	(document.head || document.documentElement).appendChild(style);
	const dbg = (msg) => console.log(`__SMARTHOME_LOG__ ${msg}`);
	dbg(`ready on ${location.hostname}${location.pathname} map=${JSON.stringify(MAP)}`);

	let current = null;

	const visible = (el) => {
		const r = el.getBoundingClientRect();
		if (r.width < 4 || r.height < 4) return false;
		const cs = getComputedStyle(el);
		if (cs.visibility === "hidden" || cs.display === "none" || parseFloat(cs.opacity) === 0) return false;
		return r.bottom > -200 && r.top < innerHeight + 200 && r.right > 0 && r.left < innerWidth;
	};
	const center = (r) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });

	// Topmost modal / dialog, if one is open: navigation stays inside it.
	const DIALOG = "[role=dialog], [aria-modal='true'], .previewModal--container, .focus-trap-wrapper, [class*='Modal--'], [class*='modal-container'], [data-testid*='modal']";
	const scope = () => {
		const dialogs = [...document.querySelectorAll(DIALOG)].filter((d) => {
			const r = d.getBoundingClientRect();
			return visible(d) && r.width * r.height > innerWidth * innerHeight * 0.15;
		});
		return dialogs.length ? dialogs[dialogs.length - 1] : null;
	};
	// Is the element actually on top at its center (not under an overlay)?
	const onTop = (el, r) => {
		const c = center(r);
		if (c.x < 0 || c.y < 0 || c.x > innerWidth || c.y > innerHeight) return true; // off-screen: can't test, allow
		const hit = document.elementFromPoint(c.x, c.y);
		return !!hit && (hit === el || el.contains(hit) || hit.contains(el));
	};
	const candidates = () => {
		const root = scope() || document;
		return [...root.querySelectorAll(SEL)].filter((el) => {
			if (el === current || el.disabled || el.closest("[aria-hidden='true']") || !visible(el)) return false;
			return onTop(el, el.getBoundingClientRect());
		});
	};
	let lastRect = null;

	const setFocus = (el) => {
		if (current && current !== el) current.classList.remove("__sh-focus");
		current = el;
		if (!el) return;
		lastRect = el.getBoundingClientRect();
		el.classList.add("__sh-focus");
		try { el.focus({ preventScroll: true }); } catch (_) { /* ignore */ }
		el.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
		// hover states (Netflix expands cards on hover)
		const c = center(el.getBoundingClientRect());
		for (const type of ["pointerover", "mouseover", "pointerenter", "mouseenter", "mousemove"]) {
			el.dispatchEvent(new MouseEvent(type, { bubbles: type !== "mouseenter" && type !== "pointerenter", clientX: c.x, clientY: c.y }));
		}
	};

	const move = (dir) => {
		const list = candidates();
		if (!list.length) return false;
		if (!current || !document.contains(current) || !visible(current) || !onTop(current, current.getBoundingClientRect())) {
			// (re)start: nearest to where the highlight last was, else top-left of the viewport
			const ref = lastRect ? center(lastRect) : { x: 0, y: 0 };
			list.sort((a, b) => {
				const ca = center(a.getBoundingClientRect()); const cb = center(b.getBoundingClientRect());
				return Math.hypot(ca.x - ref.x, ca.y - ref.y) - Math.hypot(cb.x - ref.x, cb.y - ref.y);
			});
			setFocus(list.find((el) => el.getBoundingClientRect().top >= 0) || list[0]);
			return true;
		}
		const from = current.getBoundingClientRect();
		const fc = center(from);
		let best = null;
		let bestScore = Infinity;
		for (const el of list) {
			const r = el.getBoundingClientRect();
			const c = center(r);
			let main, off;
			if (dir === "left") { main = from.left - r.right; off = Math.abs(c.y - fc.y); }
			else if (dir === "right") { main = r.left - from.right; off = Math.abs(c.y - fc.y); }
			else if (dir === "up") { main = from.top - r.bottom; off = Math.abs(c.x - fc.x); }
			else { main = r.top - from.bottom; off = Math.abs(c.x - fc.x); }
			if (main < -Math.min(from.width, from.height) * 0.5) continue; // not in that direction
			const overlap = (dir === "left" || dir === "right") ? Math.max(0, Math.min(from.bottom, r.bottom) - Math.max(from.top, r.top)) : Math.max(0, Math.min(from.right, r.right) - Math.max(from.left, r.left));
			const score = Math.max(main, 0) + off * (overlap > 0 ? 0.6 : 2.5);
			if (score < bestScore) { bestScore = score; best = el; }
		}
		if (best) { setFocus(best); return true; }
		// nothing further that way: scroll and try again
		const dx = dir === "left" ? -innerWidth * 0.6 : dir === "right" ? innerWidth * 0.6 : 0;
		const dy = dir === "up" ? -innerHeight * 0.6 : dir === "down" ? innerHeight * 0.6 : 0;
		const scroller = current.closest("[style*='overflow'], .slider, [class*='slider'], [class*='carousel']") || window;
		if (scroller === window) window.scrollBy({ left: dx, top: dy, behavior: "smooth" });
		else scroller.scrollBy({ left: dx, top: dy, behavior: "smooth" });
		setTimeout(() => { const again = candidates(); if (again.length) move(dir); }, 350);
		return true;
	};

	const video = () => {
		const vids = [...document.querySelectorAll("video")].filter((v) => v.readyState > 0 && v.getBoundingClientRect().width > innerWidth * 0.5);
		return vids[0] || null;
	};
	const wakeControls = () => {
		const v = video();
		if (!v) return;
		const r = v.getBoundingClientRect();
		for (const type of ["pointermove", "mousemove"]) document.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + r.height * 0.8 }));
	};

	document.addEventListener("keydown", (e) => {
		const typing = e.target && (/^(INPUT|TEXTAREA)$/.test(e.target.tagName) || e.target.isContentEditable);
		const a = actionFor(e);
		dbg(`key=${e.key} code=${e.code} action=${a || "none"} candidates=${candidates().length} current=${current ? current.tagName : "-"}`);
		if (!a) return;

		if (a === "home") { console.log("__SMARTHOME_BACK__"); e.preventDefault(); e.stopPropagation(); return; }
		if (a === "settings") { console.log("__SMARTHOME_SETTINGS__"); e.preventDefault(); e.stopPropagation(); return; }
		if (a === "back") {
			if (typing) return; // Backspace in a search box
			if (document.fullscreenElement) { document.exitFullscreen().catch(() => {}); e.preventDefault(); return; }
			console.log("__SMARTHOME_BACK__"); e.preventDefault(); e.stopPropagation(); return;
		}
		if (typing && a !== "up" && a !== "down") return;

		const v = video();
		const playing = v && !v.paused;
		if (a === "playpause" || (a === "select" && playing && !(current && current !== v && visible(current) && current.classList.contains("__sh-focus") && document.activeElement === current && !v.contains(current)))) {
			if (v) { v.paused ? v.play() : v.pause(); wakeControls(); e.preventDefault(); e.stopPropagation(); }
			return;
		}
		if (playing && (a === "left" || a === "right")) {
			v.currentTime = Math.max(0, v.currentTime + (a === "right" ? 10 : -10));
			wakeControls();
			e.preventDefault(); e.stopPropagation();
			return;
		}
		if (playing && (a === "up" || a === "down")) {
			wakeControls();
			setTimeout(() => move(a), 120);
			e.preventDefault(); e.stopPropagation();
			return;
		}

		if (a === "up" || a === "down" || a === "left" || a === "right") {
			if (move(a)) { e.preventDefault(); e.stopPropagation(); }
			return;
		}
		if (a === "select") {
			if (current && document.contains(current)) {
				e.preventDefault(); e.stopPropagation();
				const c = center(current.getBoundingClientRect());
				for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
					current.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: c.x, clientY: c.y, button: 0 }));
				}
			}
		}
	}, true);

	// when a modal opens, move the highlight inside it; when it closes, re-pick on the next arrow
	let lastScope = null;
	const checkScope = () => {
		const sc = scope();
		if (sc === lastScope) return;
		lastScope = sc;
		if (!sc) { if (current) { current.classList.remove("__sh-focus"); current = null; } return; }
		setTimeout(() => {
			const inside = candidates().filter((el) => sc.contains(el));
			if (!inside.length) return;
			const play = inside.find((el) => /play|resume|watch/i.test(el.getAttribute("aria-label") || el.textContent || "") && el.getBoundingClientRect().top >= 0);
			setFocus(play || inside[0]);
			dbg(`dialog opened, ${inside.length} controls, focusing ${(play || inside[0]).tagName}`);
		}, 350);
	};
	new MutationObserver(() => { clearTimeout(checkScope.t); checkScope.t = setTimeout(checkScope, 120); }).observe(document.documentElement, { childList: true, subtree: true });

	// clear our highlight when the user clicks with a real mouse
	document.addEventListener("mousedown", (e) => { if (e.isTrusted && current) { current.classList.remove("__sh-focus"); current = null; } }, true);
})();

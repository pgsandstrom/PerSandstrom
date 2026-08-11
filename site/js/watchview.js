/*!
 * watchview.js — pushes the page aside and zooms the background photo in on the
 * two people standing on the ridge.
 *
 * The photo is painted with background-size: cover, so where those two actually
 * land on screen depends on the viewport aspect ratio. Everything below works
 * backwards from a fixed point in the *image* to the matching point in the
 * viewport, scales about that point so it cannot drift, and translates it to the
 * middle of the screen. Same maths places the speech bubble.
 */
(() => {
	'use strict';

	// Where the pair stands, as a fraction of img/bergen.jpg (1280x852):
	// centre of the two of them, plus roughly how tall they are.
	const SUBJECT = { x: 0.575, y: 0.777, h: 0.051 };
	// The one doing the waving, so the bubble belongs to somebody.
	const SPEAKER = { x: 0.562, y: 0.754 };
	const ZOOM = 4.2;
	const FRAME_Y = 0.5; // where they end up on screen, top to bottom

	const html = document.documentElement;
	const scene = document.getElementById('scene');
	const bubble = document.getElementById('bubble');
	const bar = document.getElementById('bar');
	const hint = document.getElementById('hint');
	if (!scene || !bubble || !bar) return;

	let natural = { w: 1280, h: 852 }; // replaced once the real file loads
	let watching = false;

	const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

	const probe = new Image();
	probe.src = 'img/bergen.jpg';
	probe.decode().then(() => {
		if (probe.naturalWidth) natural = { w: probe.naturalWidth, h: probe.naturalHeight };
		if (watching) aim();
	}).catch(() => { /* keep the fallback dimensions */ });

	// Undo `background-size: cover` for one point: the image is scaled up until
	// it covers the viewport, then centred, so the overflow is split evenly.
	function coverBox() {
		const vw = innerWidth, vh = innerHeight;
		const cover = Math.max(vw / natural.w, vh / natural.h);
		const w = natural.w * cover, h = natural.h * cover;
		return { x: (vw - w) / 2, y: (vh - h) / 2, w, h };
	}

	// Viewport position of a point given as a fraction of the photo, at rest.
	function imgPoint(fx, fy, box) {
		return { x: box.x + fx * box.w, y: box.y + fy * box.h };
	}

	function aim() {
		const box = coverBox();
		const p = imgPoint(SUBJECT.x, SUBJECT.y, box);
		const cx = innerWidth / 2;
		const cy = innerHeight * FRAME_Y;

		// Scale about the subject so it never drifts, then slide it to the
		// middle of the screen — with transform-origin on the subject, the
		// translate lands it exactly on the target.
		scene.style.transformOrigin = `${p.x}px ${p.y}px`;
		scene.style.transform = watching
			? `translate(${cx - p.x}px, ${cy - p.y}px) scale(${ZOOM})`
			: 'scale(1)';

		// The focus vignette is body::after, so its centre goes on <body>.
		document.body.style.setProperty('--fx', `${cx}px`);
		document.body.style.setProperty('--fy', `${cy}px`);

		// Speech bubble goes just above the speaker's head. Everything moves
		// with the same scale about the subject, so the speaker ends up at
		// centre + (their offset from the subject) * ZOOM.
		const s = imgPoint(SPEAKER.x, SPEAKER.y, box);
		bubble.style.left = `${clamp(cx + (s.x - p.x) * ZOOM, 80, innerWidth - 80)}px`;
		bubble.style.top = `${Math.max(cy + (s.y - p.y) * ZOOM - 18, 62)}px`;
	}

	function setBar(on) {
		bar.querySelectorAll('[data-act]').forEach((b) => {
			b.hidden = b.dataset.act === 'back' ? !on : on;
		});
		if (hint) hint.textContent = on ? 'still up there' : 'two people, up there';
	}

	function watch() {
		if (watching) return;
		watching = true;
		html.classList.add('watching');
		aim();
		setBar(true);
	}

	function back() {
		if (!watching) return;
		watching = false;
		html.classList.remove('watching');
		aim(); // back to scale(1), same origin, so it retraces the way it came
		setBar(false);
	}

	bar.addEventListener('click', (e) => {
		const btn = e.target.closest('[data-act]');
		if (!btn) return;
		if (btn.dataset.act === 'watch') watch();
		else back();
	});

	document.addEventListener('keydown', (e) => {
		if (e.key === 'Escape') back();
		else if (e.key.toLowerCase() === 'w' && !e.metaKey && !e.ctrlKey && !e.altKey) {
			watching ? back() : watch();
		}
	});

	addEventListener('resize', () => { if (watching) aim(); });

	html.classList.add('js');
})();

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

	// Where the pair stands, as a fraction of img/bergen.jpg (4256x2832):
	// centre of the two of them, plus roughly how tall they are.
	const SUBJECT = { x: 0.640, y: 0.779, h: 0.044 };
	// Each speech bubble hangs off a head, also in image fractions. The order
	// they appear in is set by the transition-delay in the stylesheet.
	const SPEAKERS = [
		{ id: 'bubble-quote', x: 0.628, y: 0.759 }, // the one waving
		{ id: 'bubble-lol', x: 0.653, y: 0.759 }, // the one with folded arms
	];
	// This crop sits about 15% wider than the old one, so it needs proportionally
	// more zoom to bring the two of them up to the same size on screen.
	const ZOOM = 4.9;
	const FRAME_Y = 0.5; // where they end up on screen, top to bottom

	const html = document.documentElement;
	const scene = document.getElementById('scene');
	const bar = document.getElementById('bar');
	const hint = document.getElementById('hint');
	const bubbles = SPEAKERS.map((s) => ({ ...s, el: document.getElementById(s.id) }));
	if (!scene || !bar || bubbles.some((b) => !b.el)) return;

	let natural = { w: 4256, h: 2832 }; // replaced once the real file loads
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

		// Each bubble goes just above its speaker's head. Everything moves with
		// the same scale about the subject, so a speaker ends up at
		// centre + (their offset from the subject) * ZOOM.
		for (const b of bubbles) {
			const s = imgPoint(b.x, b.y, box);
			b.el.style.left = `${cx + (s.x - p.x) * ZOOM}px`;
			b.el.style.top = `${Math.max(cy + (s.y - p.y) * ZOOM - 18, 62)}px`;
		}

		// The two of them get closer together as the viewport shrinks, so the
		// long line has to be capped against the gap rather than a fixed width,
		// or it grows straight through the other guy's bubble in landscape.
		const gap = (SPEAKERS[1].x - SPEAKERS[0].x) * box.w * ZOOM;
		bubbles[0].el.style.maxWidth = `${clamp((gap - 40) * 2, 140, 240)}px`;

		// Now that the widths are settled, nudge anything hanging off an edge.
		for (const b of bubbles) {
			const half = b.el.offsetWidth / 2 + 10;
			b.el.style.left = `${clamp(parseFloat(b.el.style.left), half, innerWidth - half)}px`;
		}
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

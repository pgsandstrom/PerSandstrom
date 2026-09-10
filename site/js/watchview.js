/*!
 * watchview.js — pushes the page aside and zooms the background photo in on the
 * two people standing on the ridge.
 *
 * The photo is sized as background-size: cover would size it, so where those two
 * actually land on screen depends on the viewport aspect ratio. Everything below
 * works backwards from a fixed point in the *image* to the matching point in the
 * viewport, scales about that point so it cannot drift, and translates it to the
 * middle of the screen. Same maths places the speech bubble.
 *
 * The size is worked out here rather than left to `cover` because the layer is
 * deliberately bigger than the viewport — see OVERSCAN.
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
	// How tall the two of them should end up on screen, in CSS pixels. A fixed
	// scale factor cannot do this: cover has already scaled the photo to the
	// viewport, so the same factor compounds with it — on a 4K ultrawide the
	// old 4.9 blew them up to 735px, three times their size on a laptop, and
	// pushed the layer past the ~16k the compositor will rasterise. Aiming at a
	// height instead keeps the framing, and the bubbles hanging off it,
	// identical at every width.
	const SUBJECT_PX = 275;
	const SUBJECT_MAX_VH = 0.3; // ...but never this much of a short viewport
	const ZOOM = { min: 1.6, max: 6.5 };
	const MAX_LAYER = 15000; // px; a backstop against an absurdly big layer
	const FRAME_Y = 0.5; // where they end up on screen, top to bottom
	// The layer is grown past the viewport by up to this much a side, and the
	// photo painted into it at the size the viewport alone would have taken.
	// Nothing looks different at rest — but zooming about a point near an edge
	// no longer runs out of photo, which is exactly what a wide window causes.
	// Only ever as far as there is photo to reach, though: see `aim()`.
	const OVERSCAN = 0.3;
	// At rest, never let them sit further down the screen than this. A wide
	// window crops a lot off the top and bottom of the photo, and they stand
	// low enough in it to be cropped away altogether.
	const REST_MAX_Y = 0.86;
	// The zoom is shaped by saying how fast it should *look* like it is zooming
	// at each moment, where 1 is the steady rate an even zoom would hold all the
	// way through. PEAK_RATE is the top speed as a multiple of that, PEAK_AT is
	// where it lands. The profile has to average 1 whatever happens — that is
	// what finishing on time means — so these two trade against the tail:
	// lowering PEAK_RATE fills the tail in, raising it hollows the tail out.
	// The original curve here peaked at 3.44 and was judged too fast.
	const PEAK_RATE = 2.0;
	const PEAK_AT = 0.35; // early peak, long settle — the shape that was liked
	const EASE_STEPS = 32; // sample points in the generated timing function

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
		aim();
	}).catch(() => { /* keep the fallback dimensions */ });

	// Undo `background-size: cover` for one point: the image is scaled up until
	// it covers the viewport, then centred, so the overflow is split evenly.
	// Vertically that is only true while it can be: centring a very wide window
	// drops the pair off the bottom edge, so the crop follows them down as far
	// as the bottom of the photo allows.
	function coverBox() {
		const vw = innerWidth, vh = innerHeight;
		const cover = Math.max(vw / natural.w, vh / natural.h);
		const w = natural.w * cover, h = natural.h * cover;
		const centred = (vh - h) / 2;
		const inFrame = vh * REST_MAX_Y - SUBJECT.y * h;
		return { x: (vw - w) / 2, y: clamp(inFrame, vh - h, centred), w, h };
	}

	// Whatever it takes to bring the pair up to SUBJECT_PX from the size cover
	// already gave them.
	function zoomFor(box) {
		const target = Math.min(SUBJECT_PX, innerHeight * SUBJECT_MAX_VH);
		const fit = Math.min(target / (SUBJECT.h * box.h), MAX_LAYER / box.w);
		return clamp(fit, ZOOM.min, ZOOM.max);
	}

	// A zoom is read logarithmically: 1x to 2x looks like as much zoom as 3.25x
	// to 6.5x. A transition interpolates `scale` linearly, so for the zoom to
	// look even the scale has to move as zoom^t instead. No single cubic-bezier
	// can do that, because the right curve depends on the zoom and the zoom
	// depends on the viewport — a curve shaped for a phone's 6.5x turns
	// back-loaded on a wide monitor, which is the late speed-up. So the curve is
	// built for whatever zoom this viewport ended up with.
	const canLinear = typeof CSS !== 'undefined' &&
		CSS.supports?.('transition-timing-function', 'linear(0, 1)');

	// How far through the zoom it should *look*, moment by moment. This lives in
	// log space, so it does not depend on the zoom at all and is worked out once.
	const CURVE = (() => {
		const M = 512;
		// A rate profile of t^(a-1) * (1-t)^(b-1). Both exponents land above 1,
		// so it leaves and arrives at a standstill; placing the peak fixes b
		// from a, which leaves one number to bisect for the wanted top speed.
		const rateFor = (a) => {
			const b = 1 + ((a - 1) * (1 - PEAK_AT)) / PEAK_AT;
			const v = [];
			for (let i = 0; i <= M; i++) v.push((i / M) ** (a - 1) * (1 - i / M) ** (b - 1));
			let sum = 0;
			for (let i = 0; i <= M; i++) sum += v[i] * (i === 0 || i === M ? 0.5 : 1);
			return v.map((y) => y / (sum / M)); // ...normalised so it averages 1
		};
		let lo = 1.001, hi = 12;
		for (let i = 0; i < 50; i++) {
			const a = (lo + hi) / 2;
			if (Math.max(...rateFor(a)) < PEAK_RATE) lo = a;
			else hi = a;
		}
		const rate = rateFor((lo + hi) / 2);
		// Progress is the running integral of the rate.
		const w = [0];
		for (let i = 1; i <= M; i++) w.push(w[i - 1] + (rate[i - 1] + rate[i]) / 2 / M);
		const out = [];
		for (let i = 0; i <= EASE_STEPS; i++) out.push(w[Math.round((i / EASE_STEPS) * M)] / w[M]);
		out[EASE_STEPS] = 1; // exactly, whatever the integration drifted to
		return out;
	})();

	function timing(zoom, inward) {
		if (!(zoom > 1.001)) return 'linear';
		// Where scale should be to look that far through, undone back through
		// the linear interpolation to get the progress that puts it there. Going
		// in it climbs zoom^w; coming back out it retraces zoom^(1-w), which
		// leaves the long settle at the end of both directions.
		const pts = CURVE.map((w) => {
			const s = zoom ** (inward ? w : 1 - w);
			return ((inward ? s - 1 : zoom - s) / (zoom - 1)).toFixed(5);
		});
		return `linear(${pts.join(',')})`;
	}

	// Viewport position of a point given as a fraction of the photo, at rest.
	function imgPoint(fx, fy, box) {
		return { x: box.x + fx * box.w, y: box.y + fy * box.h };
	}

	function aim() {
		const vw = innerWidth, vh = innerHeight;
		const box = coverBox();
		const zoom = zoomFor(box);
		const p = imgPoint(SUBJECT.x, SUBJECT.y, box);
		// Everything above is in viewport coordinates; the layer starts one
		// overscan up and to the left of them.
		//
		// The overscan is only worth the photo that actually sits outside the
		// viewport — past that edge the extra layer paints nothing at all, and
		// every pixel of it still has to be rastered. `cover` fills one axis
		// exactly, so on that axis there is no overhang whatsoever: a portrait
		// phone wants none vertically, a wide window none horizontally. Both
		// end up with a layer around half the area, and because this only ever
		// trims off parts the photo never reached, `edge` below and everything
		// downstream of it come out identical.
		const ox = Math.min(vw * OVERSCAN, Math.max(0, -box.x));
		const oy = Math.min(vh * OVERSCAN, Math.max(0, -box.y, box.y + box.h - vh));
		scene.style.inset = `${-oy}px ${-ox}px`;

		// Painted at the size and place the viewport asked for, inside a bigger
		// box — cover would have blown it up to the box instead.
		scene.style.backgroundSize = `${box.w}px ${box.h}px`;
		scene.style.backgroundPosition = `${box.x + ox}px ${box.y + oy}px`;

		// How much photo there is to work with: the layer, cropped to the part
		// of it the photo actually reaches.
		const edge = {
			l: Math.max(-ox, box.x), r: Math.min(vw + ox, box.x + box.w),
			t: Math.max(-oy, box.y), b: Math.min(vh + oy, box.y + box.h),
		};
		// Where they are headed. Scaling about a point near an edge drags the
		// far edge in behind it, so the framing gives way before the photo runs
		// out — better a slightly off-centre subject than a bare strip of page.
		// With the overscan there is usually room, and this changes nothing.
		const cx = clamp(vw / 2, vw - (edge.r - p.x) * zoom, (p.x - edge.l) * zoom);
		const cy = clamp(vh * FRAME_Y, vh - (edge.b - p.y) * zoom, (p.y - edge.t) * zoom);

		// Scale about the subject so it never drifts, then slide it to the
		// middle of the screen — with transform-origin on the subject, the
		// translate lands it exactly on the target.
		scene.style.transformOrigin = `${p.x + ox}px ${p.y + oy}px`;
		// Set before the transform, so the transition that the transform kicks
		// off is already carrying the right curve. The stylesheet's
		// cubic-bezier stays as the fallback where linear() is not understood.
		if (canLinear) scene.style.setProperty('--zoom-ease', timing(zoom, watching));
		scene.style.transform = watching
			? `translate(${cx - p.x}px, ${cy - p.y}px) scale(${zoom})`
			: 'scale(1)';

		// The focus vignette is body::after, so its centre goes on <body>.
		document.body.style.setProperty('--fx', `${cx}px`);
		document.body.style.setProperty('--fy', `${cy}px`);

		// Each bubble goes just above its speaker's head. Everything moves with
		// the same scale about the subject, so a speaker ends up at
		// centre + (their offset from the subject) * zoom.
		for (const b of bubbles) {
			const s = imgPoint(b.x, b.y, box);
			b.el.style.left = `${cx + (s.x - p.x) * zoom}px`;
			b.el.style.top = `${Math.max(cy + (s.y - p.y) * zoom - 18, 62)}px`;
		}

		// The gap between the two of them is now steady across viewports, but
		// it still collapses once the zoom hits either end of its range, so the
		// long line is capped against the real gap rather than a fixed width —
		// otherwise it grows straight through the other guy's bubble.
		const gap = (SPEAKERS[1].x - SPEAKERS[0].x) * box.w * zoom;
		bubbles[0].el.style.maxWidth = `${clamp((gap - 40) * 2, 140, 240)}px`;

		// Now that the widths are settled, nudge anything hanging off an edge.
		for (const b of bubbles) {
			const half = b.el.offsetWidth / 2 + 10;
			b.el.style.left = `${clamp(parseFloat(b.el.style.left), half, vw - half)}px`;
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

	// The resting crop depends on the viewport too, so this runs either way.
	//
	// A phone fires `resize` every time its URL bar slides away or a keyboard
	// opens, which changes the height and nothing else. Re-aiming on that
	// repaints the whole layer, and moving transform-origin part-way through
	// the zoom retargets it in plain sight, so on a touch device a height-only
	// change is left alone — the framing was worked out for a viewport this
	// wide already, and rotating still changes the width. A window dragged
	// about fires a burst of these either way, so they are coalesced.
	const barSlides = matchMedia('(pointer: coarse)');
	let aimedWidth = innerWidth;
	let queued = 0;
	addEventListener('resize', () => {
		if (barSlides.matches && innerWidth === aimedWidth) return;
		clearTimeout(queued);
		queued = setTimeout(() => {
			aimedWidth = innerWidth;
			aim();
		}, 120);
	});

	// The layer's own size is set by aim() now — it depends on how much photo
	// falls outside the viewport, so it moves with the viewport like the rest.
	aim();
	html.classList.add('js');
})();

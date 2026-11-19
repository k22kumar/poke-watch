// Capture-only size overlay (docs/size-extremes-plan.md §S3). Injected into a built page by tools/sizecap.mjs; nothing in
// the game loads it, it only reads sim and renderer state, and it draws on its own 2D canvas over #game, so it moves no
// replay hash and changes no frame the game renders. Projection is the game's own: window.pokewatch.renderer.project().
//
//   __sizeOverlay.draw({ player?, labels?, marks? })  footprint circle (white), hurt cylinder (red), drawn sprite card
//                                                      (yellow: the idle reference frame's opaque bounds, as the renderer
//                                                      places it) and a label per enemy (and the partner with `player`)
//   __sizeOverlay.measure(ids)                         per-species drawn sizes and silhouette shares (see below)
//   __sizeOverlay.frame()                              the partner's drawn card against the viewport (chase framing)
(() => {
  const TPM = 16;
  const pw = window.pokewatch, R = pw.renderer;
  const sheet = (id) => R.sheets.get(id);
  const pixelsCache = new Map();
  function pixels(art) {
    let px = pixelsCache.get(art.id);
    if (!px) { const g = art.atlas.getContext('2d'); px = g.getImageData(0, 0, art.atlas.width, art.atlas.height); pixelsCache.set(art.id, px); }
    return px;
  }
  /** opaque bounds of frame f in texels, relative to its rect */
  function opaque(art, f) {
    const P = pixels(art), W = P.width;
    let x0 = f.w, x1 = -1, y0 = f.h, y1 = -1, n = 0;
    for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) if (P.data[((f.y + y) * W + f.x + x) * 4 + 3] > 0) { n++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    return { x0, x1, y0, y1, n };
  }
  const idle0 = (art, dir = 0) => art.clips.idle.frames[dir][0];
  /** the vertical stretch a creature card gets (render/renderer.ts CREATURE_VS): fixed in the classic view, by the seen
   *  elevation in third person */
  function stretchAt(x, y, z) {
    if (R.stretch > 0) return R.stretch;
    const dx = x - R.eye[0], dy = y - R.eye[1], dz = z - R.eye[2];
    return Math.min(1.6, Math.max(1, Math.hypot(dx, dy, dz) / Math.max(Math.hypot(dx, dz), 0.5)));
  }
  /** world corners of the idle card's opaque bounds for a species at feet (x, y, z) */
  function card(id, x, y, z, dir = 0) {
    const sh = sheet(id); if (!sh) return null;
    const art = sh.art, f = idle0(art, dir), o = opaque(art, f), s = sh.size.scale, st = stretchAt(x, y, z);
    const lx0 = (o.x0 - f.ax) / TPM * s, lx1 = (o.x1 + 1 - f.ax) / TPM * s;
    const ly0 = (f.ay - (o.y1 + 1)) / TPM * s * st, ly1 = (f.ay - o.y0) / TPM * s * st;
    const r = R.right, at = (lx, ly) => [x + r[0] * lx, y + ly, z + r[2] * lx];
    return { corners: [at(lx0, ly0), at(lx1, ly0), at(lx1, ly1), at(lx0, ly1)], lx0, lx1, ly0, ly1, st, scale: s };
  }
  let cv = null;
  function canvas() {
    const g = document.getElementById('game'), rc = g.getBoundingClientRect();
    if (!cv) { cv = document.createElement('canvas'); cv.id = 'size-overlay'; Object.assign(cv.style, { position: 'fixed', pointerEvents: 'none', zIndex: 50 }); document.body.appendChild(cv); }
    Object.assign(cv.style, { left: rc.left + 'px', top: rc.top + 'px', width: rc.width + 'px', height: rc.height + 'px' });
    cv.width = Math.round(rc.width); cv.height = Math.round(rc.height);
    const c = cv.getContext('2d'); c.clearRect(0, 0, cv.width, cv.height); return c;
  }
  const P = (p) => R.project(p[0], p[1], p[2]);
  function poly(c, pts, color, w = 2, close = true) {
    const q = pts.map(P); if (q.some((v) => !v)) return;
    c.strokeStyle = color; c.lineWidth = w; c.beginPath(); q.forEach(([a, b], k) => (k ? c.lineTo(a, b) : c.moveTo(a, b))); if (close) c.closePath(); c.stroke();
  }
  const ring = (x, y, z, r, n = 40) => Array.from({ length: n }, (_, k) => [x + Math.cos((k / n) * 2 * Math.PI) * r, y, z + Math.sin((k / n) * 2 * Math.PI) * r]);
  function actors(player) {
    const ctx = pw.ctx, E = ctx.enemies, out = [];
    for (let i = 0; i < E.hi; i++) if (E.alive[i]) {
      const sp = ctx.speciesIndex[E.species[i]];
      out.push({ sp, x: E.x[i], y: E.y[i], z: E.z[i], foot: E.foot[i], radius: E.radius[i], tall: E.tall[i] });
    }
    if (player) { const p = ctx.player; out.push({ sp: p.species, x: p.x, y: p.y, z: p.z, foot: p.foot ?? 0, radius: p.radius ?? 0, tall: p.tall ?? 0, player: true }); }
    return out;
  }
  function draw(opts = {}) {
    const c = canvas();
    c.font = '11px monospace'; c.textBaseline = 'bottom';
    for (const a of actors(opts.player)) {
      const sz = sheet(a.sp.id)?.size;
      if (a.foot > 0) poly(c, ring(a.x, a.y + 0.02, a.z, a.foot), '#ffffff', 2);
      if (a.radius > 0 && a.tall > 0) {
        poly(c, ring(a.x, a.y + 0.02, a.z, a.radius), '#ff3b3b', 2);
        poly(c, ring(a.x, a.y + a.tall, a.z, a.radius), '#ff3b3b', 2);
        const r = R.right;
        for (const sgn of [-1, 1]) poly(c, [[a.x + r[0] * a.radius * sgn, a.y, a.z + r[2] * a.radius * sgn], [a.x + r[0] * a.radius * sgn, a.y + a.tall, a.z + r[2] * a.radius * sgn]], '#ff3b3b', 2, false);
      }
      const k = card(a.sp.id, a.x, a.y, a.z, a.player ? 4 : 0); // the partner is seen from behind (idle direction 4)
      if (k) poly(c, k.corners, '#ffd400', 2);
      for (const m of opts.marks?.[a.sp.id] ?? []) {
        const q = P([a.x + R.right[0] * (m.dx ?? 0), a.y + m.y, a.z + R.right[2] * (m.dx ?? 0)]); if (!q) continue;
        c.fillStyle = m.hit ? '#3bff6e' : '#ff3bf2'; c.beginPath(); c.arc(q[0], q[1], 6, 0, 2 * Math.PI); c.fill();
        c.fillStyle = '#000'; c.fillRect(q[0] + 8, q[1] - 13, c.measureText(m.label).width + 6, 15); c.fillStyle = '#fff'; c.fillText(m.label, q[0] + 11, q[1]);
      }
      if (opts.labels !== false && sz && k) {
        const feet = P([a.x, a.y, a.z + (a.foot || 0.5) + 0.5]); if (!feet) continue;
        const cn = a.sp.canon ?? {};
        const lines = [
          `${a.sp.name}${a.player ? ' (partner)' : ''} · ${sz.className.replace('Extra Large', 'XL')}`,
          `listed ${cn.heightM} m ${cn.axis ?? '?'}`,
          `S ${sz.extentM.toFixed(2)} ${sz.extentSource.replace('canonical-', '')}`,
          `visual ${sz.visualM.toFixed(2)}`,
          `drawn ${(k.ly1 / k.st).toFixed(2)} × ${(k.lx1 - k.lx0).toFixed(2)}`,
          `r ${a.radius.toFixed(2)} h ${a.tall.toFixed(2)} foot ${a.foot.toFixed(2)}`,
        ];
        const w = Math.max(...lines.map((l) => c.measureText(l).width)) + 8;
        const top = feet; let ty = feet[1] + 14 - 14;
        c.fillStyle = 'rgba(0,0,0,0.72)'; c.fillRect(top[0] - w / 2, ty - 2, w, lines.length * 14 + 4);
        c.fillStyle = '#fff'; for (const l of lines) { ty += 14; c.fillText(l, top[0] - w / 2 + 4, ty); }
      }
    }
    return true;
  }
  /**
   * Per species (loaded sheets): the idle reference frame's opaque height and width in metres at level view (no stretch),
   * the widest opaque half-width over every Idle and Walk frame in all 8 directions, and the share of the idle frame's
   * opaque texels outside the hurt window (above `tall`) and outside the hurt cylinder's side view (above `tall` or
   * further than `radius` from the centre line). `tall` and `radius` are the class values (role size 1).
   */
  function measure(ids) {
    const out = {};
    for (const id of ids) {
      const sh = sheet(id); if (!sh) { out[id] = null; continue; }
      const art = sh.art, sz = sh.size, s = sz.scale, f = idle0(art), o = opaque(art, f), Px = pixels(art);
      const tall = sz.height, rad = sz.radius;
      let n = 0, above = 0, outside = 0;
      // per texel row: [height of the row's centre above the anchor (m), opaque texels, opaque texels further than the
      // radius from the centre line], so a report can split the silhouette for any hit height (xlTall)
      const rows = [];
      for (let y = 0; y < f.h; y++) {
        let rn = 0, rw = 0;
        for (let x = 0; x < f.w; x++) {
          if (Px.data[((f.y + y) * Px.width + f.x + x) * 4 + 3] === 0) continue;
          n++; rn++;
          const ly = (f.ay - (y + 0.5)) / TPM * s, lx = (x + 0.5 - f.ax) / TPM * s;
          if (Math.abs(lx) > rad) rw++;
          if (ly > tall) above++;
          if (ly > tall || Math.abs(lx) > rad) outside++;
        }
        if (rn) rows.push([(f.ay - (y + 0.5)) / TPM * s, rn, rw]);
      }
      let half = 0, widest = 0, widestAt = '';
      for (const clip of ['idle', 'walk']) {
        const fr = art.clips[clip]?.frames ?? [];
        fr.forEach((dir, d) => dir.forEach((g) => {
          const q = opaque(art, g); if (q.x1 < q.x0) return;
          const l = (g.ax - q.x0) / TPM * s, r = (q.x1 + 1 - g.ax) / TPM * s;
          if (Math.max(l, r) > half) half = Math.max(l, r);
          if (l + r > widest) { widest = l + r; widestAt = `${clip} dir ${d}`; }
        }));
      }
      out[id] = {
        className: sz.className, extentM: sz.extentM, visualM: sz.visualM, scale: s, wide: sz.wide, neutralCoreM: sz.neutralCoreM,
        heightPx: art.heightPx, widthPx: art.widthPx, radius: rad, height: tall, body: sz.body,
        drawnH: (f.ay - o.y0) / TPM * s, drawnW: (o.x1 - o.x0 + 1) / TPM * s,
        cellH: f.h / TPM * s, cellW: f.w / TPM * s, // the idle frame's cell (what the rig at b89fb55 framed)
        outline: sh.outline ?? null, // the measured outline at the drawn scale: what the chase rig frames since 90fc1b7 (render/framing.ts)
        idleLeft: (f.ax - o.x0) / TPM * s, idleRight: (o.x1 + 1 - f.ax) / TPM * s,
        maxHalfWidth: half, maxWidth: widest, maxWidthAt: widestAt,
        shareAboveHurt: above / n, shareOutsideCylinder: outside / n, rows,
      };
    }
    return out;
  }
  /** the partner's card against the viewport (CSS px), and the chase rig's arm (render/camera.ts ChaseRig, 90fc1b7):
   *  the ideal back distance and shoulder for the outline, what is in use this frame, the pivot and the outline corner */
  function frame() {
    const p = pw.ctx.player, k = card(p.species.id, p.x, p.y, p.z, 4), q = k.corners.map(P);
    const xs = q.map((v) => v[0]), ys = q.map((v) => v[1]);
    const rig = R.rig;
    return {
      viewport: [R.width, R.height], card: { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) },
      inFrame: Math.min(...xs) >= 0 && Math.max(...xs) <= R.width && Math.min(...ys) >= 0 && Math.max(...ys) <= R.height,
      rig: rig ? { backWant: rig.backWant, shoulderWant: rig.shoulderWant, boom: rig.boomUsed, shoulder: rig.shoulderUsed, lensGap: rig.lensGap, pivotH: rig.pivotH, cornerTop: rig.cornerTop, cornerRight: rig.cornerRight, eye: R.eye, pitch: R.pitch } : null,
      cardM: { w: k.lx1 - k.lx0, h: k.ly1, st: k.st },
      feetToEye: Math.hypot(R.eye[0] - p.x, R.eye[2] - p.z), eyeAboveFeet: R.eye[1] - p.y,
      margins: { left: Math.min(...xs), right: R.width - Math.max(...xs), top: Math.min(...ys), bottom: R.height - Math.max(...ys) },
    };
  }
  window.__sizeOverlay = { draw, measure, frame, card };
})();

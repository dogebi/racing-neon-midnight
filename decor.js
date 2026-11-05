/* Neon Midnight - decor.js
   트랙 주변 소품: 가로등, 네온 간판 게이트, 건물 실루엣, 터널, 고가교 기둥,
   스카이라인 배경, 지면 그리드, 별. 모두 코드 생성 텍스처/지오메트리. */
const NMDecor = (function () {
  'use strict';

  function canvasTex(w, h, fn, repeat) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    fn(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
    t.anisotropy = 4;
    return t;
  }

  // 창문이 켜진 건물 파사드 텍스처 (팔레트 변형 3종)
  function buildingTex(base, palette) {
    return canvasTex(128, 256, function (g, w, h) {
      g.fillStyle = base; g.fillRect(0, 0, w, h);
      const cols = 8, rows = 20;
      const cw = w / cols, ch = h / rows;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (Math.random() < 0.55) continue; // 꺼진 창
          const p = palette[Math.random() * palette.length | 0];
          g.fillStyle = p;
          g.globalAlpha = 0.5 + Math.random() * 0.5;
          g.fillRect(c * cw + 2, r * ch + 2, cw - 4, ch - 4);
        }
      }
      g.globalAlpha = 1;
      g.fillStyle = 'rgba(0,0,0,0.35)';
      for (let r = 0; r < rows; r += 5) g.fillRect(0, r * ch, w, 2);
    });
  }

  function signTexture(text, colorA, colorB) {
    return canvasTex(512, 128, function (g, w, h) {
      g.fillStyle = '#0a0616'; g.fillRect(0, 0, w, h);
      g.strokeStyle = colorB; g.lineWidth = 6;
      g.shadowColor = colorB; g.shadowBlur = 18;
      g.strokeRect(10, 10, w - 20, h - 20);
      g.font = 'italic 900 64px "Segoe UI", sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillStyle = colorA; g.shadowColor = colorA; g.shadowBlur = 26;
      g.fillText(text, w / 2, h / 2 + 4);
    });
  }

  function glowDiscTexture() {
    return canvasTex(128, 128, function (g, w, h) {
      const r = g.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w / 2);
      r.addColorStop(0, 'rgba(255,235,190,0.95)');
      r.addColorStop(0.4, 'rgba(255,190,120,0.35)');
      r.addColorStop(1, 'rgba(255,160,80,0)');
      g.fillStyle = r; g.fillRect(0, 0, w, h);
    });
  }

  // InstancedMesh 헬퍼 (item.color 있으면 인스턴스별 색상 적용)
  function makeInstances(scene, geo, mat, items) {
    const im = new THREE.InstancedMesh(geo, mat, items.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(),
      up = new THREE.Vector3(0, 1, 0), v = new THREE.Vector3(), s = new THREE.Vector3();
    const col = new THREE.Color();
    let hasColor = false;
    items.forEach(function (it, i) {
      q.setFromAxisAngle(up, it.ry || 0);
      v.set(it.x, it.y, it.z); s.set(it.sx || 1, it.sy || 1, it.sz || 1);
      m4.compose(v, q, s);
      im.setMatrixAt(i, m4);
      if (it.color) { im.setColorAt(i, col.set(it.color)); hasColor = true; }
    });
    if (hasColor) im.instanceColor.needsUpdate = true;
    scene.add(im);
    return im;
  }

  function build(scene, track) {
    const N = track.N, segLen = track.segLen, totalLen = track.totalLen;
    const [tS0, tS1] = track.tunnelS;
    const P = []; // 누적 placement 목록들

    // ---- 지면 (그리드) ----
    const gridT = canvasTex(256, 256, function (g, w, h) {
      g.fillStyle = '#07040e'; g.fillRect(0, 0, w, h);
      g.strokeStyle = 'rgba(123,45,255,0.28)'; g.lineWidth = 1;
      for (let i = 0; i <= 4; i++) {
        const p = i * w / 4;
        g.beginPath(); g.moveTo(p, 0); g.lineTo(p, h); g.stroke();
        g.beginPath(); g.moveTo(0, p); g.lineTo(w, p); g.stroke();
      }
    }, true);
    gridT.repeat.set(160, 160);
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(3200, 3200),
      new THREE.MeshBasicMaterial({ map: gridT, color: 0x8a86c8 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.18;
    scene.add(ground);

    // ---- 별 ----
    const starPos = [];
    for (let i = 0; i < 700; i++) {
      const a = Math.random() * Math.PI * 2;
      const el = 0.06 + Math.random() * 0.9;
      const r = 950;
      starPos.push(Math.cos(a) * Math.cos(el) * r, Math.sin(el) * r, Math.sin(a) * Math.cos(el) * r);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3));
    scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({
      color: 0xaabbff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0.8
    })));

    // ---- 스카이라인 배경 실린더 (지평선 핑크 글로우) ----
    const skyT = canvasTex(1024, 256, function (g, w, h) {
      const gr = g.createLinearGradient(0, 0, 0, h);
      gr.addColorStop(0, '#020108');
      gr.addColorStop(0.55, '#0a0420');
      gr.addColorStop(0.82, '#33104e');
      gr.addColorStop(0.94, '#94246e');
      gr.addColorStop(1, '#ff5e9e');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
      // 먼 건물 실루엣
      g.fillStyle = 'rgba(6,2,16,0.95)';
      let x = 0;
      while (x < w) {
        const bw = 18 + Math.random() * 46;
        const bh = 20 + Math.random() * 70;
        g.fillRect(x, h - bh, bw, bh);
        x += bw + 4;
      }
    });
    const sky = new THREE.Mesh(
      new THREE.CylinderGeometry(760, 760, 300, 48, 1, true),
      new THREE.MeshBasicMaterial({ map: skyT, side: THREE.BackSide, fog: false }));
    sky.position.y = 60;
    scene.add(sky);

    // ---- 가로등 (터널 밖, 30m 간격 좌우 교대) ----
    const poles = [], arms = [], glows = [], pools = [];
    const lampStep = 30 / segLen; // 샘플 간격
    const glowT = glowDiscTexture();
    let side = 1;
    for (let i = 0; i < N; i += lampStep) {
      const s = track.sv[i];
      if (s > tS0 - 25 && s < tS1 + 25) continue; // 터널 주변 제외
      const h = track.headingAt(i);
      const off = 11.6 * side;
      const lx = track.sx[i] + off * track.sideX[i];
      const lz = track.sz[i] + off * track.sideZ[i];
      const ly = track.sy[i];
      const tilt = side > 0 ? h + Math.PI : h; // 도로 쪽으로 팔이 향하도록
      poles.push({ x: lx, y: ly + 4, z: lz, ry: h, sx: 1, sy: 1, sz: 1 });
      arms.push({ x: lx - Math.sin(tilt) * 0 + side * track.sideX[i] * -1.6, y: ly + 7.9,
                  z: lz + side * track.sideZ[i] * -1.6, ry: h });
      glows.push({ x: lx + side * track.sideX[i] * -3.0, y: ly + 7.7,
                   z: lz + side * track.sideZ[i] * -3.0, ry: h });
      pools.push({ x: lx + side * track.sideX[i] * -3.4, y: ly + 0.12,
                   z: lz + side * track.sideZ[i] * -3.4, ry: h });
      side = -side;
    }
    makeInstances(scene, new THREE.BoxGeometry(0.22, 8, 0.22),
      new THREE.MeshBasicMaterial({ color: 0x181328 }), poles);
    makeInstances(scene, new THREE.BoxGeometry(0.16, 0.14, 3.2),
      new THREE.MeshBasicMaterial({ color: 0x181328 }), arms);
    const glowMat = new THREE.MeshBasicMaterial({
      map: glowT, transparent: true, blending: THREE.AdditiveBlending,
      depthWrite: false, side: THREE.DoubleSide });
    makeInstances(scene, new THREE.PlaneGeometry(2.6, 1.6), glowMat, glows);
    makeInstances(scene, new THREE.PlaneGeometry(11, 7).rotateX(-Math.PI / 2),
      glowMat.clone(), pools);

    // ---- 네온 간판 게이트 (130m 간격) ----
    const names = [
      ['NEON MIDNIGHT', '#00e5ff', '#ff2d95'], ['2AM EXPWY', '#ff2d95', '#7b2dff'],
      ['DRIFT ZONE', '#ffd166', '#ff2d95'], ['SYNTH WAVE', '#7b2dff', '#00e5ff'],
      ['MIDNIGHT', '#00e5ff', '#7b2dff'], ['CITY LOOP', '#ff2d95', '#ffd166']
    ];
    const gateStep = 130 / segLen;
    const gPosts = [], gBeams = [];
    let gi = 0;
    for (let i = Math.floor(N * 0.04); i < N; i += gateStep) {
      const s = track.sv[i];
      if (s > tS0 - 30 && s < tS1 + 30) continue;
      const h = track.headingAt(i);
      const name = names[gi % names.length][0];
      const ca = names[gi % names.length][1], cb = names[gi % names.length][2];
      for (const sgn of [1, -1]) {
        gPosts.push({ x: track.sx[i] + sgn * 12.2 * track.sideX[i], y: track.sy[i] + 3.4,
                      z: track.sz[i] + sgn * 12.2 * track.sideZ[i], ry: h });
      }
      gBeams.push({ x: track.sx[i], y: track.sy[i] + 7.2, z: track.sz[i], ry: h });
      const panel = new THREE.Mesh(
        new THREE.PlaneGeometry(12, 3),
        new THREE.MeshBasicMaterial({ map: signTexture(name, ca, cb), side: THREE.DoubleSide }));
      panel.position.set(track.sx[i], track.sy[i] + 5.3, track.sz[i]);
      panel.rotation.y = h;
      scene.add(panel);
      gi++;
    }
    makeInstances(scene, new THREE.BoxGeometry(0.5, 7, 0.5),
      new THREE.MeshBasicMaterial({ color: 0x1d1735 }), gPosts);
    makeInstances(scene, new THREE.BoxGeometry(25, 0.45, 0.45),
      new THREE.MeshBasicMaterial({ color: 0x241b45 }), gBeams);

    // ---- 스타트 게이트 ----
    const sp = track.spawn;
    const gatePanel = new THREE.Mesh(
      new THREE.PlaneGeometry(17, 4),
      new THREE.MeshBasicMaterial({ map: signTexture('START', '#ff2d95', '#00e5ff'), side: THREE.DoubleSide }));
    gatePanel.position.set(sp.x, sp.y + 6.4, sp.z);
    gatePanel.rotation.y = sp.heading;
    scene.add(gatePanel);
    const gp = [];
    for (const sgn of [1, -1]) {
      gp.push({ x: sp.x + Math.cos(sp.heading) * sgn * 9.6, y: sp.y + 4, z: sp.z - Math.sin(sp.heading) * sgn * 9.6, ry: sp.heading });
    }
    makeInstances(scene, new THREE.BoxGeometry(0.6, 8.4, 0.6),
      new THREE.MeshBasicMaterial({ color: 0x1d1735 }), gp);

    // ---- 터널: 벽 2 + 천장 + 네온 링 ----
    function tunnelBand(off, y, flip) {
      const i0 = Math.max(0, Math.floor(tS0 / segLen) - 2), i1 = Math.min(N - 1, Math.ceil(tS1 / segLen) + 2);
      const pos = [], uv = [], idx = [];
      let row = 0;
      for (let i = i0; i <= i1; i++) {
        const x = track.sx[i] + off * track.sideX[i], z = track.sz[i] + off * track.sideZ[i];
        pos.push(x, track.sy[i] + y, z, x, track.sy[i] + (y === 6.3 ? 6.3 : y + 6.3), z);
        const v = (track.sv[i] - tS0) / 8;
        uv.push(flip ? 1 : 0, v, flip ? 0 : 1, v);
        if (row > 0) {
          const a = (row - 1) * 2, b = a + 1, c = row * 2, d = c + 1;
          idx.push(a, c, b, b, c, d);
        }
        row++;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      geo.setIndex(idx);
      return geo;
    }
    const tunnelTex = canvasTex(128, 128, function (g, w, h) {
      g.fillStyle = '#0d0819'; g.fillRect(0, 0, w, h);
      g.strokeStyle = 'rgba(123,45,255,0.4)'; g.lineWidth = 2;
      for (let i = 0; i <= 4; i++) {
        const p = i * w / 4;
        g.beginPath(); g.moveTo(p, 0); g.lineTo(p, h); g.stroke();
        g.beginPath(); g.moveTo(0, i * h / 4); g.lineTo(w, i * h / 4); g.stroke();
      }
    }, true);
    const twMat = new THREE.MeshBasicMaterial({ map: tunnelTex, color: 0x9a86d8, side: THREE.DoubleSide });
    scene.add(new THREE.Mesh(tunnelBand(9.0, 0, false), twMat));
    scene.add(new THREE.Mesh(tunnelBand(-9.0, 0, true), twMat));
    // 천장: 좌우 벽 상단을 잇는 수평 밴드
    function ceilingBand(offL, offR, y) {
      const i0 = Math.max(0, Math.floor(tS0 / segLen) - 2), i1 = Math.min(N - 1, Math.ceil(tS1 / segLen) + 2);
      const pos = [], uv = [], idx = [];
      let row = 0;
      for (let i = i0; i <= i1; i++) {
        const xl = track.sx[i] + offL * track.sideX[i], zl = track.sz[i] + offL * track.sideZ[i];
        const xr = track.sx[i] + offR * track.sideX[i], zr = track.sz[i] + offR * track.sideZ[i];
        pos.push(xl, track.sy[i] + y, zl, xr, track.sy[i] + y, zr);
        const v = (track.sv[i] - tS0) / 8;
        uv.push(0, v, 1, v);
        if (row > 0) {
          const a = (row - 1) * 2, b = a + 1, c = row * 2, d = c + 1;
          idx.push(a, c, b, b, c, d);
        }
        row++;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      geo.setIndex(idx);
      return geo;
    }
    scene.add(new THREE.Mesh(ceilingBand(9.0, -9.0, 6.3), twMat));
    const ringLen = Math.max(6, Math.floor((tS1 - tS0) / 9));
    const rings = [];
    let ringFlip = false;
    for (let r = 0; r < ringLen; r++) {
      const s = tS0 + 8 + (tS1 - tS0 - 16) * r / (ringLen - 1);
      const i = Math.floor(s / segLen) % N;
      const h = track.headingAt(i);
      const ringCol = ringFlip ? 0x00e5ff : 0xff2d95; // 시안/핑크 교대
      // part 0/1: 좌우 기둥, part 2: 상부 가로 빔 (유닛 박스 + 인스턴스 스케일)
      for (const part of [0, 1, 2]) {
        const lat = part === 0 ? 8.7 : part === 1 ? -8.7 : 0;
        const px = track.sx[i] + lat * track.sideX[i];
        const pz = track.sz[i] + lat * track.sideZ[i];
        const py = track.sy[i] + (part === 2 ? 6.2 : 3.1);
        rings.push({ x: px, y: py, z: pz, ry: h, color: ringCol,
          sx: part === 2 ? 17.8 : 0.3,
          sy: part === 2 ? 0.3 : 6.2,
          sz: 0.3 });
      }
      ringFlip = !ringFlip;
    }
    makeInstances(scene, new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ color: 0xffffff }), rings); // 발광 네온 링 (시안/핑크)

    // ---- 고가교 기둥 ----
    const pillars = [];
    for (let i = 0; i < N; i += Math.round(18 / segLen)) {
      if (track.sy[i] < 1.6) continue;
      for (const sgn of [1, -1]) {
        pillars.push({
          x: track.sx[i] + sgn * 8.5 * track.sideX[i],
          y: track.sy[i] / 2,
          z: track.sz[i] + sgn * 8.5 * track.sideZ[i],
          ry: track.headingAt(i), sy: track.sy[i]
        });
      }
    }
    makeInstances(scene, new THREE.BoxGeometry(1.3, 1, 1.3),
      new THREE.MeshBasicMaterial({ color: 0x14101f }), pillars);

    // ---- 건물 실루엣 ----
    const texes = [
      buildingTex('#0b0817', ['#00e5ff', '#ff2d95', '#ffd9a0', '#7b2dff']),
      buildingTex('#0e0a1c', ['#ffd166', '#00e5ff', '#ff5e9e']),
      buildingTex('#080612', ['#9aa7ff', '#ff2d95', '#00e5ff'])
    ];
    const bItems = [[], [], []];
    let rng = 12345;
    function rnd() { rng = (rng * 1103515245 + 12345) & 0x7fffffff; return rng / 0x7fffffff; }
    let placed = 0, guard = 0;
    while (placed < 150 && guard < 3000) {
      guard++;
      const i = Math.floor(rnd() * N);
      if (track.sy[i] > 1.6) { /* 고가 구간 주변도 배치 가능 */ }
      const sgn = rnd() < 0.5 ? 1 : -1;
      const off = 42 + rnd() * 130;
      const bx = track.sx[i] + sgn * off * track.sideX[i];
      const bz = track.sz[i] + sgn * off * track.sideZ[i];
      // 도로 전 구간과의 이격 확인 (전역 스캔, 4칸 스텝)
      let ok = true;
      for (let j = 0; j < N; j += 4) {
        const dx = bx - track.sx[j], dz = bz - track.sz[j];
        if (dx * dx + dz * dz < 34 * 34) { ok = false; break; }
      }
      if (!ok) continue;
      const fw = 14 + rnd() * 20, fh = 16 + rnd() * 85;
      bItems[placed % 3].push({ x: bx, y: fh / 2, z: bz, ry: rnd() * Math.PI,
        sx: fw, sy: fh, sz: 14 + rnd() * 20 });
      placed++;
    }
    for (let k = 0; k < 3; k++) {
      makeInstances(scene, new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshBasicMaterial({ map: texes[k], color: 0xb0aed0 }), bItems[k]);
    }

    return { glowMat: glowMat };
  }

  return { build: build };
})();

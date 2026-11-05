/* Neon Midnight - track.js
   도시 서킷 중심선 / 노면 / 가드레일 지오메트리 + 충돌 조회.
   전역 스크립트 (THREE 전역 사용). */
const NMTrack = (function () {
  'use strict';

  const HALF_WIDTH = 7.5;   // 노면 반폭 (m)
  const WALL_X = 6.7;       // 차량 중심이 넘으면 충돌로 판정되는 횡위치 한계
  const RAIL_OFF = 8.0;     // 가드레일 발광 스트립의 중심선 기준 오프셋
  const TEX_REPEAT = 18;    // 노면 텍스처 1타일 = 18m

  // 트랙 제어점 [x, y(고도), z]  — 시작 직선 → 광폭 드리프트 코너 → 고속 S자 → 고가도로(상승)
  // → 고가 직선 → 우측 곡선 강하 → 터널 직선 → 복귀. 총 연장 약 1.85km (랩 40~60초)
  const CTRL = [
    [   0, 0,    0],
    [ 180, 0,    0],
    [ 300, 0,  -30],
    [ 380, 0, -110],
    [ 400, 0, -230],
    [ 380, 2, -350],
    [ 300, 6, -420],
    [ 200,10, -460],
    [  80,12, -480],
    [ -60,12, -470],
    [-170,12, -430],
    [-240,10, -340],
    [-260, 4, -230],
    [-240, 2, -120],
    [-180, 0,  -20],
    [ -80, 0,   18]
  ];

  function makeCanvas(w, h, fn) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    fn(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 4;
    return t;
  }

  function roadTexture() {
    return makeCanvas(256, 256, function (g, w, h) {
      g.fillStyle = '#101018'; g.fillRect(0, 0, w, h);
      // 아스팔트 스펙클
      for (let i = 0; i < 900; i++) {
        const v = 20 + Math.random() * 26 | 0;
        g.fillStyle = 'rgba(' + v + ',' + v + ',' + (v + 8) + ',0.5)';
        g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
      }
      // 타일 이음새 (매 18m 횡줄)
      g.fillStyle = 'rgba(255,255,255,0.04)'; g.fillRect(0, 0, w, 2);
      // 노측 실선 (핑크빛 흰색)
      g.fillStyle = 'rgba(255,190,220,0.85)';
      g.fillRect(Math.round(w * 0.035), 0, 5, h);
      g.fillRect(Math.round(w * 0.965) - 5, 0, 5, h);
      // 차선 점선
      g.fillStyle = 'rgba(220,225,255,0.35)';
      for (const u of [0.28, 0.72]) {
        for (let y = 0; y < h; y += 64) g.fillRect(Math.round(w * u) - 2, y, 4, 34);
      }
      // 중앙 시안 점선 (신스웨이브 포인트)
      g.fillStyle = 'rgba(0,229,255,0.8)';
      g.shadowColor = '#00e5ff'; g.shadowBlur = 6;
      for (let y = 0; y < h; y += 128) g.fillRect(w / 2 - 3, y, 6, 70);
    });
  }

  function gridTexture() {
    return makeCanvas(256, 256, function (g, w, h) {
      g.fillStyle = '#08050f'; g.fillRect(0, 0, w, h);
      g.strokeStyle = 'rgba(123,45,255,0.30)'; g.lineWidth = 1;
      for (let i = 0; i <= 4; i++) {
        const p = i * w / 4;
        g.beginPath(); g.moveTo(p, 0); g.lineTo(p, h); g.stroke();
        g.beginPath(); g.moveTo(0, p); g.lineTo(w, p); g.stroke();
      }
    });
  }

  function railStripTexture() {
    return makeCanvas(64, 128, function (g, w, h) {
      g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#fff'; g.fillRect(w / 2 - 8, 10, 16, h - 20);
      g.fillStyle = 'rgba(255,255,255,0.25)';
      for (let y = 0; y < h; y += 32) g.fillRect(0, y, w, 6);
    });
  }

  function build(scene) {
    const pts = CTRL.map(function (p) { return new THREE.Vector3(p[0], p[1], p[2]); });
    const curve = new THREE.CatmullRomCurve3(pts, true, 'catmullrom', 0.55);
    const totalLen = curve.getLength();
    const N = 720;
    const raw = curve.getSpacedPoints(N); // raw[N] == raw[0] (closed)
    const segLen = totalLen / N;

    const sx = new Float32Array(N), sy = new Float32Array(N), sz = new Float32Array(N);
    const tx = new Float32Array(N), tz = new Float32Array(N);
    const sX = new Float32Array(N), sZ = new Float32Array(N);   // side(측면) 단위벡터
    const kv = new Float32Array(N);                              // 부호 있는 곡률
    const sv = new Float32Array(N);                              // 누적 거리

    for (let i = 0; i < N; i++) {
      sx[i] = raw[i].x; sy[i] = raw[i].y; sz[i] = raw[i].z;
      sv[i] = i * segLen;
    }
    for (let i = 0; i < N; i++) {
      const a = (i - 1 + N) % N, b = (i + 1) % N;
      let dx = sx[b] - sx[a], dz = sz[b] - sz[a];
      const l = Math.hypot(dx, dz) || 1;
      tx[i] = dx / l; tz[i] = dz / l;
      sX[i] = tz[i]; sZ[i] = -tx[i];
    }
    for (let i = 0; i < N; i++) {
      const b = (i + 1) % N;
      const crossY = tx[i] * tz[b] - tz[i] * tx[b]; // (t_i × t_{i+1})의 y성분
      const ang = Math.asin(Math.max(-1, Math.min(1, crossY)));
      kv[i] = ang / segLen;
    }

    // 제어점 인근의 s 값 찾기 (터널 구간 정의용)
    function sOfCtrl(idx) {
      let best = 0, bd = Infinity;
      for (let i = 0; i < N; i += 2) {
        const dx = CTRL[idx][0] - sx[i], dz = CTRL[idx][2] - sz[i];
        const d = dx * dx + dz * dz;
        if (d < bd) { bd = d; best = i; }
      }
      return sv[best];
    }
    const tunnelS = [sOfCtrl(12), sOfCtrl(14)];

    // ---- 노면 리본 ----
    const roadTex = roadTexture();
    roadTex.repeat.set(1, 1);
    function ribbon(offsetR, offsetL, y0, y1, vScale, material) {
      // offsetR/L: 측면방향 오프셋(m). y0/y1: 상대높이. 두 단면(좌우)만 사용하는 밴드
      const pos = [], uv = [], idx = [], col = [];
      for (let i = 0; i < N; i++) {
        const cx = sx[i] + offsetR * sX[i], cz = sz[i] + offsetR * sZ[i];
        const dx2 = sx[i] + offsetL * sX[i], dz2 = sz[i] + offsetL * sZ[i];
        pos.push(cx, sy[i] + y0, cz, dx2, sy[i] + y1, dz2);
        const v = sv[i] / vScale;
        uv.push(0, v, 1, v);
        col.push(1, 1, 1, 1, 1, 1);
      }
      for (let i = 0; i < N; i++) {
        const a = i * 2, b = i * 2 + 1, c2 = ((i + 1) % N) * 2, d2 = ((i + 1) % N) * 2 + 1;
        idx.push(a, c2, b, b, c2, d2);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      geo.setIndex(idx);
      const mesh = new THREE.Mesh(geo, material);
      scene.add(mesh);
      return mesh;
    }

    const roadMat = new THREE.MeshBasicMaterial({ map: roadTex, color: 0xb8b8d8, side: THREE.DoubleSide });
    ribbon(HALF_WIDTH, -HALF_WIDTH, 0.05, 0.05, TEX_REPEAT, roadMat);

    // ---- 가드레일 발광 스트립 (곡률에 따라 핑크/시안) ----
    const railGeoCol = [];
    function railRibbon(off, y0, y1, flipU) {
      const pos = [], uv = [], idx = [], col = [];
      for (let i = 0; i < N; i++) {
        const cx = sx[i] + off * sX[i], cz = sz[i] + off * sZ[i];
        pos.push(cx, sy[i] + y0, cz, cx, sy[i] + y1, cz);
        const v = sv[i] / 6;
        uv.push(flipU ? 1 : 0, v, flipU ? 0 : 1, v);
        const k = Math.abs(kv[i]);
        const hot = k > 0.0075;
        // hot: 핑크 / 직선: 시안, 위쪽이 더 밝게
        const r = hot ? 1 : 0.1, g = hot ? 0.18 : 0.9, b = hot ? 0.58 : 1;
        col.push(r * 0.45, g * 0.45, b * 0.45, r, g, b);
      }
      for (let i = 0; i < N; i++) {
        const a = i * 2, b = i * 2 + 1, c2 = ((i + 1) % N) * 2, d2 = ((i + 1) % N) * 2 + 1;
        idx.push(a, c2, b, b, c2, d2);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      geo.setIndex(idx);
      railGeoCol.push(geo);
      const mat = new THREE.MeshBasicMaterial({
        map: railStripTexture(), vertexColors: true,
        blending: THREE.AdditiveBlending, transparent: true,
        depthWrite: false, side: THREE.DoubleSide
      });
      const m = new THREE.Mesh(geo, mat);
      scene.add(m);
      return m;
    }
    railRibbon(RAIL_OFF, 0.15, 1.05, false);
    railRibbon(-RAIL_OFF, 0.15, 1.05, true);

    // ---- 가드레일 포스트 (InstancedMesh) ----
    const postStep = 8;
    const postCount = Math.floor(N * segLen / postStep) * 2;
    const postMesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.16, 1.0, 0.16),
      new THREE.MeshBasicMaterial({ color: 0x2a2340 }), postCount);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), sc = new THREE.Vector3(1, 1, 1);
    let pi = 0;
    for (let d = 0; d < N * segLen; d += postStep) {
      const i = Math.floor(d / segLen) % N;
      for (const sgn of [1, -1]) {
        if (pi >= postCount) break;
        q.setFromAxisAngle(up, Math.atan2(tx[i], tz[i]));
        m4.compose(new THREE.Vector3(sx[i] + sgn * RAIL_OFF * sX[i], sy[i] + 0.55, sz[i] + sgn * RAIL_OFF * sZ[i]), q, sc);
        postMesh.setMatrixAt(pi++, m4);
      }
    }
    postMesh.count = pi;
    scene.add(postMesh);

    const api = {
      N: N, totalLen: totalLen, segLen: segLen,
      sx: sx, sy: sy, sz: sz, tx: tx, tz: tz,
      sideX: sX, sideZ: sZ, kv: kv, sv: sv,
      HALF_WIDTH: HALF_WIDTH, WALL_X: WALL_X, RAIL_OFF: RAIL_OFF,
      tunnelS: tunnelS,
      _q: { idx: 0, s: 0, lat: 0, y: 0, tanX: 0, tanZ: 0, curv: 0, tunnel: false },

      // 차량 위치 → 중심선 조회 (hint: 이전 idx)
      query: function (x, z, hint) {
        let best = -1, bd = Infinity;
        if (hint >= 0) {
          for (let k = -50; k <= 50; k++) {
            const i = ((hint + k) % N + N) % N;
            const dx = x - sx[i], dz = z - sz[i];
            const d = dx * dx + dz * dz;
            if (d < bd) { bd = d; best = i; }
          }
          if (bd > 2500) best = -1; // 이탈 판정 → 전역 탐색
        }
        if (best < 0) {
          for (let i = 0; i < N; i += 4) {
            const dx = x - sx[i], dz = z - sz[i];
            const d = dx * dx + dz * dz;
            if (d < bd) { bd = d; best = i; }
          }
          for (let k = -4; k <= 4; k++) {
            const i = ((best + k) % N + N) % N;
            const dx = x - sx[i], dz = z - sz[i];
            const d = dx * dx + dz * dz;
            if (d < bd) { bd = d; best = i; }
          }
        }
        const dx = x - sx[best], dz = z - sz[best];
        let along = dx * tx[best] + dz * tz[best];
        const lat = dx * sX[best] + dz * sZ[best];
        const s = (sv[best] + along + totalLen) % totalLen;
        const nb = (best + 1) % N;
        const slope = (sy[nb] - sy[best]) / segLen;
        const ac = Math.max(-segLen, Math.min(segLen, along));
        const y = sy[best] + slope * ac;
        const out = this._q;
        out.idx = best; out.s = s; out.lat = lat; out.y = y;
        out.tanX = tx[best]; out.tanZ = tz[best];
        out.curv = kv[best];
        out.tunnel = s >= tunnelS[0] && s <= tunnelS[1];
        return out;
      },

      isElevated: function (i) { return sy[i] > 1.5; },
      headingAt: function (i) { return Math.atan2(tx[i], tz[i]); },
      spawn: null
    };

    const si = 4;
    api.spawn = {
      x: sx[si], y: sy[si], z: sz[si],
      heading: api.headingAt(si), idx: si
    };
    return api;
  }

  return { build: build };
})();

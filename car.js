/* Neon Midnight - car.js
   low-poly 박스 조합 차량 + 헤드라이트/브레이크등/언더글로우 + 드리프트 라이트 트레일.
   전역 스크립트. */
const NMCar = (function () {
  'use strict';

  function glowMat(color, opacity) {
    return new THREE.MeshBasicMaterial({
      color: color, transparent: true, opacity: opacity,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
    });
  }

  function buildCarMesh(scene) {
    const root = new THREE.Group();

    const bodyMat = new THREE.MeshLambertMaterial({ color: 0x141824 });
    const accentMat = glowMat(0xff2d95, 0.9);
    const glassMat = new THREE.MeshLambertMaterial({ color: 0x12082a });

    // 로우폴리 바디
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.5, 4.3), bodyMat);
    body.position.y = 0.55;
    root.add(body);
    const nose = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.32, 1.0), bodyMat);
    nose.position.set(0, 0.42, 2.45);
    root.add(nose);
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.5, 1.9), glassMat);
    cabin.position.set(0, 1.02, -0.15);
    root.add(cabin);
    // 사이드 네온 라인
    for (const sgn of [1, -1]) {
      const line = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.07, 3.9), accentMat);
      line.position.set(sgn * 0.97, 0.62, 0);
      root.add(line);
    }
    // 스포일러
    const wing = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.09, 0.5), bodyMat);
    wing.position.set(0, 1.12, -2.05);
    root.add(wing);
    for (const sgn of [1, -1]) {
      const stand = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.34, 0.12), bodyMat);
      stand.position.set(sgn * 0.75, 0.93, -2.05);
      root.add(stand);
    }

    // 헤드라이트 (백열 쿼드 + 광원 콘)
    const headMat = glowMat(0xeaf6ff, 0.95);
    for (const sgn of [1, -1]) {
      const hl = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.16), headMat);
      hl.position.set(sgn * 0.6, 0.55, 2.96);
      root.add(hl);
    }
    const beamGeo = new THREE.ConeGeometry(1.7, 16, 12, 1, true);
    beamGeo.translate(0, -8, 0);
    beamGeo.rotateX(-Math.PI / 2); // +Z 방향으로
    const beamMat = new THREE.MeshBasicMaterial({
      color: 0x8fb4ff, transparent: true, opacity: 0.07,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
    });
    const beam = new THREE.Mesh(beamGeo, beamMat);
    beam.position.set(0, 0.55, 3.0);
    root.add(beam);

    // 브레이크등 / 테일램프
    const tailMat = glowMat(0xff1e4e, 0.55);
    const brakeMat = glowMat(0xff2050, 0.0);
    for (const sgn of [1, -1]) {
      const tl = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.14), tailMat);
      tl.position.set(sgn * 0.62, 0.62, -2.17);
      root.add(tl);
      const bl = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.2), brakeMat);
      bl.position.set(sgn * 0.62, 0.62, -2.18);
      bl.rotation.y = Math.PI;
      root.add(bl);
    }
    // 리버스/부스트 배기 플레어
    const exhaustMat = glowMat(0x66d9ff, 0.0);
    const exhaust = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), exhaustMat);
    exhaust.position.set(0, 0.42, -2.3);
    root.add(exhaust);

    // 언더글로우
    const under = new THREE.Mesh(new THREE.PlaneGeometry(2.5, 4.6).rotateX(-Math.PI / 2),
      glowMat(0xb42dff, 0.28));
    under.position.y = 0.06;
    root.add(under);

    // 휠
    const wheelGeo = new THREE.CylinderGeometry(0.37, 0.37, 0.32, 14);
    wheelGeo.rotateZ(Math.PI / 2);
    const wheelMat = new THREE.MeshLambertMaterial({ color: 0x0c0c14 });
    const rimMat = glowMat(0x00e5ff, 0.7);
    const rimGeo = new THREE.TorusGeometry(0.20, 0.035, 6, 18);
    const wheels = [];
    const wheelPos = [
      [ 0.86, 0.37, 1.42], [-0.86, 0.37, 1.42],
      [ 0.88, 0.37, -1.5], [-0.88, 0.37, -1.5]
    ];
    wheelPos.forEach(function (p, i) {
      const pivot = new THREE.Group();
      pivot.position.set(p[0], p[1], p[2]);
      const w = new THREE.Mesh(wheelGeo, wheelMat);
      const rim = new THREE.Mesh(rimGeo, rimMat);
      rim.rotation.y = Math.PI / 2;
      pivot.add(w); pivot.add(rim);
      root.add(pivot);
      wheels.push({ pivot: pivot, wheel: w, rim: rim, front: i < 2 });
    });

    scene.add(root);

    return {
      root: root, wheels: wheels,
      brakeMat: brakeMat, tailMat: tailMat,
      exhaustMat: exhaustMat, beamMat: beamMat,
      steerGroup: null
    };
  }

  // ---- 드리프트 라이트 트레일 (정점 알파 페이드 리본) ----
  function Trail(scene, color, maxSegs) {
    this.maxSegs = maxSegs;
    this.pos = new Float32Array(maxSegs * 4 * 3);
    this.col = new Float32Array(maxSegs * 4 * 4);
    this.idx = [];
    for (let i = 0; i < maxSegs; i++) {
      const a = i * 4;
      this.idx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
    }
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 4));
    this.geo.setIndex(this.idx);
    this.geo.setDrawRange(0, 0);
    this.mat = new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.segs = []; // {x1,z1,x2,z2,life}
    this.r = (color >> 16 & 255) / 255;
    this.g = (color >> 8 & 255) / 255;
    this.b = (color & 255) / 255;
  }
  Trail.prototype.push = function (x1, z1, x2, z2, y) {
    this.segs.push({ x1: x1, z1: z1, x2: x2, z2: z2, y: y, life: 1.0 });
    if (this.segs.length > this.maxSegs) this.segs.shift();
  };
  Trail.prototype.update = function (dt, width) {
    for (let i = this.segs.length - 1; i >= 0; i--) {
      this.segs[i].life -= dt * 1.6;
      if (this.segs[i].life <= 0) this.segs.splice(i, 1);
    }
    const n = this.segs.length;
    for (let i = 0; i < n; i++) {
      const s = this.segs[i];
      const o = i * 12;
      const w = width * 0.5 * s.life;
      // 횡방향 (차 방향과 무관하게 XY 평면에서 수직 방향으로 폭)
      let dx = s.x2 - s.x1, dz = s.z2 - s.z1;
      const l = Math.hypot(dx, dz) || 1;
      const px = -dz / l * w, pz = dx / l * w;
      this.pos[o] = s.x1 - px; this.pos[o + 1] = s.y; this.pos[o + 2] = s.z1 - pz;
      this.pos[o + 3] = s.x1 + px; this.pos[o + 4] = s.y; this.pos[o + 5] = s.z1 + pz;
      this.pos[o + 6] = s.x2 - px; this.pos[o + 7] = s.y; this.pos[o + 8] = s.z2 - pz;
      this.pos[o + 9] = s.x2 + px; this.pos[o + 10] = s.y; this.pos[o + 11] = s.z2 + pz;
      const a = s.life * s.life * 0.85;
      const c = i * 16;
      for (let k = 0; k < 4; k++) {
        this.col[c + k * 4] = this.r;
        this.col[c + k * 4 + 1] = this.g;
        this.col[c + k * 4 + 2] = this.b;
        this.col[c + k * 4 + 3] = a;
      }
    }
    this.geo.setDrawRange(0, n * 6);
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
  };
  Trail.prototype.clear = function () {
    this.segs.length = 0;
    this.geo.setDrawRange(0, 0);
  };

  // ---- 차량 비주얼 컨트롤러 ----
  function CarVis(scene) {
    this.mesh = buildCarMesh(scene);
    this.trailL = new Trail(scene, 0x00e5ff, 80);
    this.trailR = new Trail(scene, 0xff2d95, 80);
    this.prevL = null; this.prevR = null;
  }

  CarVis.prototype.update = function (dt, car, input, boosting, inTunnel) {
    const m = this.mesh;
    // 바디 위치/자세 (드리프트 시 슬립각 일부를 바디에 가산)
    m.root.position.set(car.x, car.y + 0.02, car.z);
    const bodyYaw = car.heading + car.slip * 0.55;
    m.root.rotation.set(-car.pitch, bodyYaw, car.roll);

    // 휠 회전/조향
    const spin = (car.speed / 0.37) * dt * (1 + car.wheelSpin * 2.2);
    for (const w of m.wheels) {
      w.wheel.rotation.x += spin;
      w.rim.rotation.x = w.wheel.rotation.x;
      if (w.front) w.pivot.rotation.y = car.steer * 0.5;
    }

    // 브레이크등
    const braking = input.brake > 0 || input.hand;
    m.brakeMat.opacity = braking ? 0.95 : 0.0;
    m.tailMat.opacity = braking ? 0.9 : 0.5;

    // 부스트 배기 플레어 + 헤드라이트 빔 강도
    m.exhaustMat.opacity = boosting ? 0.5 + Math.random() * 0.5 : 0;
    m.beamMat.opacity = inTunnel ? 0.16 : 0.10;

    // 드리프트 라이트 트레일: 후륜 지면 위치 추적
    const drifting = car.drift && car.speed > 7;
    const ca = Math.cos(car.heading), sa = Math.sin(car.heading);
    // 로컬 (±0.88, -1.5) → 월드: wx = lx*ca + lz*sa, wz = -lx*sa + lz*ca
    const rl = { x: car.x - 0.88 * ca - 1.5 * sa, z: car.z + 0.88 * sa - 1.5 * ca };
    const rr = { x: car.x + 0.88 * ca - 1.5 * sa, z: car.z - 0.88 * sa - 1.5 * ca };
    if (drifting) {
      if (this.prevL) {
        this.trailL.push(this.prevL.x, this.prevL.z, rl.x, rl.z, car.y + 0.12);
        this.trailR.push(this.prevR.x, this.prevR.z, rr.x, rr.z, car.y + 0.12);
      }
      this.prevL = rl; this.prevR = rr;
    } else {
      this.prevL = null; this.prevR = null;
    }
    this.trailL.update(dt, 0.5);
    this.trailR.update(dt, 0.5);
  };

  CarVis.prototype.reset = function () {
    this.trailL.clear();
    this.trailR.clear();
    this.prevL = null; this.prevR = null;
  };

  return { CarVis: CarVis };
})();

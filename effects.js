/* Neon Midnight - effects.js
   속도감 연출 (이 게임의 주인공):
   - 속도 비례 FOV 확장 + 부스트 추가 확장
   - 추격 카메라 (속도에 따라 후방 거리 증가, 드리프트 시 측면 오프셋)
   - 임팩트/속도 기반 카메라 셰이크 (trauma 시스템)
   - 스피드 스트릭 (도로 주변을 스쳐 가는 광 스트립 = 라이트 스트리밍)
   - 속도/터널 반응 안개 + DOM 비네트/글로우
   전역 스크립트. */
const NMEffects = (function () {
  'use strict';

  const BASE_FOV = 63, MAX_FOV_ADD = 30, BOOST_FOV_ADD = 8;

  function streakTexture() {
    const c = document.createElement('canvas');
    c.width = 8; c.height = 128;
    const g = c.getContext('2d');
    const gr = g.createLinearGradient(0, 0, 0, 128);
    gr.addColorStop(0, 'rgba(255,255,255,0)');
    gr.addColorStop(0.5, 'rgba(255,255,255,1)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 8, 128);
    return new THREE.CanvasTexture(c);
  }

  function Effects(scene, camera, track, dom) {
    this.scene = scene;
    this.camera = camera;
    this.track = track;
    this.dom = dom; // { vignette, speedglow, flash }
    this.t = 0;
    this.trauma = 0;
    this.camPos = new THREE.Vector3();
    this.camLook = new THREE.Vector3();
    this.shakeSeed = Math.random() * 1000;

    scene.fog = new THREE.Fog(0x0a0418, 42, 430);
    scene.background = new THREE.Color(0x07030f);

    // ---- 스피드 스트릭 (인스턴스 광 스트립) ----
    const COUNT = 46;
    const tex = streakTexture();
    this.streakMat = new THREE.MeshBasicMaterial({
      map: tex, color: 0x9fe8ff, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
    });
    this.streaks = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(0.5, 1), this.streakMat, COUNT);
    this.streaks.frustumCulled = false;
    this.streakData = [];
    for (let i = 0; i < COUNT; i++) {
      this.streakData.push({ s: 0, lat: 0, hOff: 0, len: 10, active: false });
    }
    scene.add(this.streaks);
    this._m4 = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._up = new THREE.Vector3(0, 1, 0);
    this._v = new THREE.Vector3();
    this._sc = new THREE.Vector3();
  }

  Effects.prototype.addImpact = function (amount) {
    this.trauma = Math.min(1, this.trauma + amount);
  };

  // 스피드 스트릭 1개 리스폰 (차 전방에 생성)
  Effects.prototype._respawn = function (sd, car, sHint) {
    const q = this.track.query(car.x, car.z, car.idx);
    sd.s = (sHint !== undefined ? sHint : q.s) + 25 + Math.random() * 130;
    sd.lat = (Math.random() < 0.5 ? -1 : 1) * (9 + Math.random() * 16);
    sd.hOff = Math.random() * 7 + 0.6;
    sd.len = 8 + Math.random() * 14;
    sd.active = true;
  };

  Effects.prototype.update = function (dt, car, input, state) {
    this.t += dt;
    const T = this.track;
    const q = T.query(car.x, car.z, car.idx);
    const speed = car.speed;
    const ratio = Math.min(1, speed / NMPhysics.TUNE.maxSpeed);

    // ---- FOV ----
    let targetFov = BASE_FOV
      + Math.pow(ratio, 0.75) * MAX_FOV_ADD
      + (car.boosting ? BOOST_FOV_ADD : 0)
      + (car.drift ? 3 : 0);
    this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 5);
    this.camera.updateProjectionMatrix();

    // ---- 추격 카메라 ----
    const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
    const sxv = Math.cos(car.heading), szv = -Math.sin(car.heading);
    const dist = 7.0 + speed * 0.045 + (car.boosting ? 1.2 : 0);
    const height = 2.7 + speed * 0.012;
    const latOff = Math.max(-2.4, Math.min(2.4, -car.vL * 0.18));
    this._v.set(
      car.x - fx * dist + sxv * latOff,
      car.y + height,
      car.z - fz * dist + szv * latOff);
    const lerp = 1 - Math.exp(-dt * 6.5);
    this.camPos.lerp(this._v, lerp);

    // 지면/노면 아래로 처지지 않도록
    const cq = T.query(this.camPos.x, this.camPos.z, car.idx);
    const minY = Math.max(cq.y, q.y) + 1.2;
    if (this.camPos.y < minY) this.camPos.y = minY;

    // 셰이크 (trauma 제곱으로 감쇠 곡선)
    this.trauma = Math.max(0, this.trauma - dt * 1.7);
    const speedShake = ratio * ratio * 0.16;
    const amp = (this.trauma * this.trauma * 0.9 + speedShake) * 0.045;
    const t0 = this.t * 31 + this.shakeSeed;
    this.camera.position.copy(this.camPos);
    this.camera.position.x += Math.sin(t0) * amp * 0.6;
    this.camera.position.y += Math.sin(t0 * 1.7) * amp * 0.4;
    this.camera.position.z += Math.cos(t0 * 0.9) * amp * 0.6;

    const lookX = car.x + fx * 7.5 + sxv * latOff * 0.4;
    const lookZ = car.z + fz * 7.5 + szv * latOff * 0.4;
    this.camLook.lerp(this._v.set(lookX, car.y + 1.25, lookZ), Math.min(1, dt * 9));
    this.camera.lookAt(this.camLook);
    this.camera.rotation.z += Math.sin(t0 * 0.6) * amp * 0.35 + car.vL * 0.006;

    // ---- 스피드 스트릭 ----
    const streakVis = Math.max(0, (ratio - 0.28) / 0.72) + (car.boosting ? 0.35 : 0);
    this.streakMat.opacity = Math.min(0.85, streakVis * 0.85);
    if (this.streakMat.opacity > 0.02) {
      const qs = q.s;
      for (let i = 0; i < this.streakData.length; i++) {
        const sd = this.streakData[i];
        if (!sd.active) { this._respawn(sd, car, qs); continue; }
        // s 갱신 (차 기준 뒤로 6m 이상 벗어나면 리스폰)
        let rel = sd.s - qs;
        if (rel > T.totalLen / 2) rel -= T.totalLen;
        if (rel < -6) { this._respawn(sd, car, qs); rel = sd.s - qs; if (rel > T.totalLen / 2) rel -= T.totalLen; }
        const si = Math.floor(((sd.s % T.totalLen) + T.totalLen) % T.totalLen / T.segLen) % T.N;
        const stretch = 1 + ratio * 2.4; // 속도에 따라 스트립 늘어남 (모션블러 느낌)
        const len = sd.len * stretch;
        this._sc.set(1, len, 1);
        this._q.setFromAxisAngle(this._up, T.headingAt(si));
        this._v.set(
          T.sx[si] + sd.lat * T.sideX[si],
          T.sy[si] + sd.hOff,
          T.sz[si] + sd.lat * T.sideZ[si]);
        this._m4.compose(this._v, this._q, this._sc);
        this.streaks.setMatrixAt(i, this._m4);
      }
      this.streaks.instanceMatrix.needsUpdate = true;
    } else {
      for (let i = 0; i < this.streakData.length; i++) this.streakData[i].active = false;
    }

    // ---- 안개 (속도: 멀리 보이게 / 터널: 밀착) ----
    const fog = this.scene.fog;
    const targetNear = q.tunnel ? 7 : 42 - ratio * 12;
    const targetFar = q.tunnel ? 150 : 400 + ratio * 160;
    fog.near += (targetNear - fog.near) * Math.min(1, dt * 3);
    fog.far += (targetFar - fog.far) * Math.min(1, dt * 3);

    // ---- DOM 오버레이 ----
    if (this.dom) {
      const glow = ratio * ratio * 0.5 + (car.boosting ? 0.3 : 0);
      this.dom.speedglow.style.opacity = glow.toFixed(3);
      this.dom.vignette.style.opacity = (0.55 + ratio * 0.25).toFixed(3);
    }
  };

  Effects.prototype.flash = function (op) {
    if (!this.dom) return;
    this.dom.flash.style.opacity = op;
  };

  Effects.prototype.reset = function () {
    this.trauma = 0;
    for (let i = 0; i < this.streakData.length; i++) this.streakData[i].active = false;
  };

  return { Effects: Effects };
})();

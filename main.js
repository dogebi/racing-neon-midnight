/* Neon Midnight - main.js
   초기화, 입력, 게임 루프, 랩 타이밍, 드리프트 점수/부스트, 리스타트. */
(function () {
  'use strict';

  if (!window.THREE) {
    document.getElementById('errbox').style.display = 'block';
    document.getElementById('errbox').textContent =
      'Three.js 로드 실패 — 네트워크(CDN) 연결을 확인해 주세요.';
    return;
  }

  // ---- 렌더러/씬 ----
  var canvas = document.getElementById('game');
  var renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, powerPreference: 'high-performance' });
  } catch (e) {
    document.getElementById('errbox').style.display = 'block';
    document.getElementById('errbox').textContent = 'WebGL을 초기화할 수 없습니다: ' + e.message;
    return;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);

  var scene = new THREE.Scene();
  var camera = new THREE.PerspectiveCamera(63, window.innerWidth / window.innerHeight, 0.1, 1400);
  camera.position.set(0, 4, 12);

  scene.add(new THREE.AmbientLight(0x5548a0, 1.25));
  var dir = new THREE.DirectionalLight(0x8fb4ff, 0.9);
  dir.position.set(0.4, 1, 0.3);
  scene.add(dir);
  var rim = new THREE.DirectionalLight(0xff2d95, 0.5);
  rim.position.set(-0.6, 0.4, -0.7);
  scene.add(rim);

  // ---- 구성 요소 빌드 ----
  var track = NMTrack.build(scene);
  NMDecor.build(scene, track);
  var carVis = new NMCar.CarVis(scene);
  var fx = new NMEffects.Effects(scene, camera, track, {
    speedglow: document.getElementById('speedglow'),
    vignette: document.getElementById('vignette'),
    flash: document.getElementById('flash')
  });
  var audio = new NMAudio.AudioSys();
  var hud = new NMHud.Hud();

  // ---- 차량 ----
  var car = NMPhysics.createCar(track.spawn);
  var s0 = track.sv[track.spawn.idx]; // 랩 기준선 (스폰 지점)

  // ---- 입력 ----
  var keys = {};
  var input = { steer: 0, throttle: 0, brake: 0, hand: false, boost: false };
  var boostEdge = false, boostPlayed = false;

  window.addEventListener('keydown', function (e) {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].indexOf(e.code) >= 0) e.preventDefault();
    if (!keys[e.code]) onKeyEdge(e.code);
    keys[e.code] = true;
  });
  window.addEventListener('keyup', function (e) { keys[e.code] = false; });
  window.addEventListener('blur', function () { keys = {}; });

  function readInput() {
    var up = keys['KeyW'] || keys['ArrowUp'];
    var down = keys['KeyS'] || keys['ArrowDown'];
    var left = keys['KeyA'] || keys['ArrowLeft'];
    var right = keys['KeyD'] || keys['ArrowRight'];
    input.throttle = up ? 1 : 0;
    input.brake = down ? 1 : 0;
    input.steer = (left ? 1 : 0) + (right ? -1 : 0);
    input.hand = !!keys['Space'];
    input.boost = !!(keys['ShiftLeft'] || keys['ShiftRight']);
  }

  // ---- 게임 상태 ----
  var state = {
    started: false,
    lapTime: 0,
    best: null,
    lapCount: 1,
    score: 0,
    driftChain: 0,
    driftTime: 0,
    prog: s0,
    flashOp: 0
  };

  function onKeyEdge(code) {
    if (!state.started) {
      startGame();
      return;
    }
    if (code === 'KeyR') restart();
    if (code === 'KeyM') {
      audio.setMuted(!audio.muted);
      hud.toast(audio.muted ? 'MUTE ON' : 'MUTE OFF');
    }
    if ((code === 'ShiftLeft' || code === 'ShiftRight') && car.boostMeter > NMPhysics.TUNE.boostMin) {
      boostPlayed = false; // edge 재무장 (update에서 발동)
    }
  }

  function startGame() {
    state.started = true;
    hud.hideOverlay();
    hud.showHud();
    audio.init();
    audio.resume();
    hud.toast('LAP 1 — GO!', 2.0);
  }

  function restart() {
    var sp = track.spawn;
    car.x = sp.x; car.z = sp.z; car.y = sp.y;
    car.heading = sp.heading; car.idx = sp.idx;
    car.vx = car.vz = car.vF = car.vL = 0;
    car.steer = 0; car.drift = false; car.driftTime = 0;
    car.slip = 0; car.boostMeter = 0; car.boosting = false;
    carVis.reset();
    fx.reset();
    state.lapTime = 0;
    state.prog = s0;
    state.driftChain = 0; state.driftTime = 0;
    hud.toast('RESTART', 1.5);
  }

  // ---- 드리프트 점수 / 부스트 ----
  function updateDriftScore(dt) {
    if (car.drift && car.speed > 7) {
      state.driftTime += dt;
      var gain = car.speed * (0.45 + Math.abs(car.slip) * 1.4) * dt * 60;
      state.driftChain += gain;
      if (state.driftChain > 60) {
        hud.driftGain(state.driftChain, state.score + state.driftChain);
      }
    } else if (state.driftChain > 0) {
      // 체인 종료 → 점수 확정 + 부스트 충전
      var mult = 1 + Math.min(2, state.driftTime * 0.45);
      var pts = state.driftChain * mult;
      state.score += pts;
      car.boostMeter = Math.min(1, car.boostMeter + state.driftChain / 2400);
      if (pts > 200) hud.toast('DRIFT +' + Math.floor(pts) + '  (x' + mult.toFixed(1) + ')', 1.4);
      state.driftChain = 0;
      state.driftTime = 0;
    }
  }

  // ---- 랩 타이밍 (단조 진행도 기반) ----
  function updateLap(prevS, s) {
    var L = track.totalLen;
    var d = s - prevS;
    if (d > L / 2) d -= L;
    if (d < -L / 2) d += L;
    if (Math.abs(d) < L / 4) state.prog += d; // 순간이동성 점프 방지
    var target = s0 + state.lapCount * L;
    if (state.prog >= target) {
      var t = state.lapTime;
      var isBest = state.best == null || t < state.best;
      if (isBest) state.best = t;
      audio.lap();
      hud.toast('LAP ' + state.lapCount + ' — ' + NMHud.fmtTime(t) +
        (isBest ? '  BEST!' : '  (BEST ' + NMHud.fmtTime(state.best) + ')'), 3.2);
      state.lapCount++;
    }
  }

  // ---- 메인 루프 ----
  var prevS = s0;
  var lastT = performance.now();

  function frame(now) {
    requestAnimationFrame(frame);
    var dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;
    if (dt <= 0) return;

    readInput();

    if (state.started) {
      // 부스트 edge: Shift를 누른 순간 사운드 1회
      if (input.boost && car.boostMeter > NMPhysics.TUNE.boostMin && !boostPlayed) {
        boostPlayed = true;
        audio.boost();
        fx.addImpact(0.12);
      }
      if (!input.boost) boostPlayed = false;

      NMPhysics.step(car, input, dt, track);

      var q = track.query(car.x, car.z, car.idx);
      updateLap(prevS, q.s);
      prevS = q.s;
      if (state.started) state.lapTime += dt;

      updateDriftScore(dt);

      // 충돌 반응
      if (car.impactAcc > 2.5) {
        fx.addImpact(Math.min(0.6, car.impactAcc * 0.045));
        audio.impact(car.impactAcc);
        state.flashOp = Math.min(0.4, car.impactAcc * 0.03);
        if (car.drift || state.driftChain > 0) {
          state.driftChain *= 0.3; // 충돌 시 드리프트 체인 페널티
        }
      }
    }

    // 비주얼/오디오/HUD
    var qq = track.query(car.x, car.z, car.idx);
    carVis.update(dt, car, input, car.boosting, qq.tunnel);
    fx.update(dt, car, input, state);
    audio.update(dt, car, qq.tunnel);

    if (state.flashOp > 0) {
      state.flashOp = Math.max(0, state.flashOp - dt * 1.6);
      fx.flash(state.flashOp.toFixed(3));
    }

    if (state.started) {
      hud.update(dt, {
        kmh: car.kmh,
        lapTime: state.lapTime,
        lapCount: state.lapCount,
        best: state.best,
        score: state.score,
        boost: car.boostMeter
      });
    }

    renderer.render(scene, camera);
  }

  // ---- 리사이즈 ----
  window.addEventListener('resize', function () {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // 오버레이 클릭으로도 시작
  document.getElementById('overlay').addEventListener('click', function () {
    if (!state.started) startGame();
  });

  // 디버그 훅 (콘솔용): NM_DEBUG.teleport(0~1) — 트랙 진행률 위치로 순간이동
  window.NM_DEBUG = {
    teleport: function (frac) {
      var i = Math.floor(((frac % 1) + 1) % 1 * (track.N - 1));
      car.x = track.sx[i]; car.z = track.sz[i]; car.y = track.sy[i];
      car.heading = track.headingAt(i);
      car.vx = car.vz = car.vF = car.vL = 0;
      car.idx = i; car.drift = false; car.slip = 0;
      carVis.reset();
      state.prog = track.sv[i];
      prevS = track.sv[i];
    }
  };

  requestAnimationFrame(frame);
})();

/* Neon Midnight - physics.js
   아케이드 드리프트 물리. 그립↔슬립 경계를 넓게 잡아 드리프트를 쉽게 진입/유지.
   전역 스크립트. */
const NMPhysics = (function () {
  'use strict';

  const TUNE = {
    maxSpeed: 63,        // m/s ≈ 227 km/h
    boostMaxSpeed: 76,   // 부스트 중 최고속
    maxReverse: -11,
    engineAccel: 21,
    boostAccel: 30,
    brakeDecel: 36,
    reverseAccel: 10,
    drag: 0.30,          // v*|v|*drag (비례항 위주)
    rollResist: 1.1,
    steerMax: 0.62,      // 라디안 (최대 조향각 개념)
    steerRate: 7.0,      // 조향 입력 스무딩
    gripYaw: 1.35,       // 그립 주행 요우 속도 계수
    driftYaw: 1.9,       // 드리프트 중 요우 속도 계수
    gripLat: 9.5,        // 그립 시 측면속도 감쇠 계수
    driftLat: 1.7,       // 드리프트 시 측면 감쇠 (넓은 미끄러짐)
    handLat: 1.05,
    slipEnter: 0.30,     // 드리프트 진입 슬립각
    slipExit: 0.13,      // 해제 슬립각 (히스테리시스)
    handbrakeSpeed: 8,   // 핸드브레이크 드리프트 최소 속도
    driftKick: 3.2,      // 드리프트 중 조향시 측면 킥
    wallBounce: 0.42,    // 가드레일 반발계수
    wallScrapeDecay: 2.6, // 접촉 중 초당 종방향 감쇠 계수 (지수감쇠)
    boostDrain: 0.45,    // 게이지 1.0 = 약 2.2초
    boostMin: 0.02
  };

  function createCar(spawn) {
    return {
      x: spawn.x, z: spawn.z, y: spawn.y,
      heading: spawn.heading,
      vx: 0, vz: 0,
      steer: 0,
      vF: 0, vL: 0,           // 전방/측면 속도 성분 (차체 기준)
      speed: 0, kmh: 0,
      slip: 0,                // 슬립각 (rad)
      drift: false,           // 드리프트 상태
      driftTime: 0,           // 연속 드리프트 시간
      boosting: false,
      boostMeter: 0.0,
      wheelSpin: 0,           // 타이어 스핀 시각/사운드용 0..1
      pitch: 0, roll: 0,      // 차체 자세 (시각)
      idx: spawn.idx,         // 트랙 조회 힌트
      engineLoad: 0,          // 오디오용 스로틀 부하
      impactAcc: 0,           // 프레임 충격 누적 (쉐이크/사운드)
      scraping: false
    };
  }

  // 부분 스텝 1회
  function substep(car, input, dt, track, ev) {
    const T = TUNE;
    // 조향 스무딩
    const target = input.steer;
    const rate = (Math.abs(target) > 0.01 ? T.steerRate : T.steerRate * 1.4) * dt;
    car.steer += Math.max(-rate, Math.min(rate, target - car.steer));

    const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
    const sxv = Math.cos(car.heading), szv = -Math.sin(car.heading); // 측면 단위벡터

    let vF = car.vx * fx + car.vz * fz;
    let vL = car.vx * sxv + car.vz * szv;
    const speed = Math.hypot(car.vx, car.vz);

    // ---- 드리프트 상태 머신 ----
    car.slip = Math.atan2(vL, Math.abs(vF) + 2.5);
    const handbrake = input.hand && speed > T.handbrakeSpeed;
    if (!car.drift) {
      if ((handbrake && speed > T.handbrakeSpeed) || Math.abs(car.slip) > T.slipEnter) {
        car.drift = true;
        car.driftTime = 0;
      }
    } else {
      if (Math.abs(car.slip) < T.slipExit && !handbrake) car.drift = false;
      if (speed < 4) car.drift = false;
    }
    if (car.drift) car.driftTime += dt; else car.driftTime = 0;

    // ---- 부스트 ----
    const wantBoost = input.boost && car.boostMeter > T.boostMin;
    car.boosting = wantBoost;
    if (car.boosting) car.boostMeter = Math.max(0, car.boostMeter - dt * T.boostDrain);

    // ---- 종방향 힘 ----
    const maxS = car.boosting ? T.boostMaxSpeed : T.maxSpeed;
    let aF = 0;
    if (input.throttle > 0 && vF < maxS) {
      const taper = Math.max(0.15, 1 - Math.max(0, vF) / maxS);
      aF += (car.boosting ? T.boostAccel : T.engineAccel) * taper * input.throttle;
    }
    if (input.brake > 0) {
      if (vF > 0.6) aF -= T.brakeDecel * input.brake;
      else if (vF > T.maxReverse) aF -= T.reverseAccel * input.brake;
    }
    // 저항
    aF -= vF * Math.abs(vF) * T.drag * 0.012;
    aF -= Math.sign(vF) * T.rollResist;
    if (input.hand) aF -= Math.sign(vF) * 6;      // 핸드브레이크 감속
    vF += aF * dt;
    if (vF < T.maxReverse) vF = T.maxReverse;

    // ---- 요우 (회전) ----
    const speedFactor = Math.min(1, speed / 7); // 정지 시 회전 없음
    const speedDamp = 1 / (1 + speed * 0.022);
    const yawBase = (car.drift ? T.driftYaw : T.gripYaw) * T.steerMax;
    let yawRate = car.steer * yawBase * speedFactor * speedDamp * (car.boosting ? 0.92 : 1);
    // 드리프트 중 리어가 미끄러지며 자연 회전 보정 (컨터스테어 여유)
    if (car.drift) yawRate += car.steer * 0.5 * speedFactor;
    car.heading += yawRate * dt;

    // ---- 측면 그립/슬라이드 ----
    let latK = car.drift ? T.driftLat : T.gripLat;
    if (input.hand) latK = T.handLat;
    if (!car.drift && speed > 30) latK *= 1.25; // 고속 다운포스 느낌
    vL *= Math.exp(-latK * dt);
    // 드리프트 중 조향에 따른 측면 킥 (슬라이드 유지)
    if (car.drift) {
      vL += car.steer * T.driftKick * speedFactor * dt * (input.throttle > 0 ? 1.35 : 0.8);
    }
    // 핸드브레이크 진입 시 후륜 브레이크 킥
    if (input.hand && speed > T.handbrakeSpeed) {
      vL += car.steer * 2.4 * speedFactor * dt * 4;
    }

    // 슬립 재계산 (드리프트 상태 판정 정착용)
    car.slip = Math.atan2(vL, Math.abs(vF) + 2.5);
    car.wheelSpin = Math.max(0, Math.min(1,
      (car.drift ? 0.55 + Math.abs(car.slip) * 1.2 : 0) +
      (input.throttle > 0 && speed < 14 ? 0.5 : 0) +
      (input.hand && speed > 2 ? 0.4 : 0)));

    // ---- 월드 속도 재구성 & 적분 ----
    car.vx = fx * vF + sxv * vL;
    car.vz = fz * vF + szv * vL;
    car.x += car.vx * dt;
    car.z += car.vz * dt;

    // ---- 트랙 조회 & 가드레일 충돌 ----
    const q = track.query(car.x, car.z, car.idx);
    car.idx = q.idx;
    car.y = q.y;

    if (Math.abs(q.lat) > track.WALL_X) {
      const sgn = Math.sign(q.lat);
      const pen = Math.abs(q.lat) - track.WALL_X;
      // 위치 보정 (도로 안쪽으로 밀어넣기)
      car.x -= sgn * track.sideX[q.idx] * pen;
      car.z -= sgn * track.sideZ[q.idx] * pen;
      // 트랙 프레임에서 측면 속도 반사
      const vSide = car.vx * track.sideX[q.idx] + car.vz * track.sideZ[q.idx];
      const vTan = car.vx * track.tx[q.idx] + car.vz * track.tz[q.idx];
      if (vSide * sgn > 0) {
        const impact = Math.abs(vSide);
        if (impact > 2.2) ev.impact += impact;
        const vSide2 = -vSide * TUNE.wallBounce;
        // 스크래프 감속: 서브스텝 빈도에 무관하게 초당 지수 감쇠
        const vTan2 = vTan * Math.exp(-TUNE.wallScrapeDecay * dt);
        car.vx = track.tx[q.idx] * vTan2 + track.sideX[q.idx] * vSide2;
        car.vz = track.tz[q.idx] * vTan2 + track.sideZ[q.idx] * vSide2;
        ev.scrape = true;
      } else {
        ev.scrape = true;
      }
    }

    // ---- 자세 (시각용: pitch는 노즈업 양수) ----
    const nb = (q.idx + 1) % track.N;
    const slope = (track.sy[nb] - track.sy[q.idx]) / track.segLen;
    const align = fx * track.tx[q.idx] + fz * track.tz[q.idx]; // 차두와 트랙 방식 정렬
    car.pitch = Math.atan(slope * align);
    car.roll = Math.max(-0.09, Math.min(0.09,
      vL * 0.012 + yawRate * speed * 0.004));

    car.vF = vF; car.vL = vL;
    car.speed = Math.hypot(car.vx, car.vz);
    car.kmh = car.speed * 3.6;
    car.engineLoad = input.throttle;
  }

  function step(car, input, dt, track) {
    const ev = { impact: 0, scrape: false };
    car.impactAcc = 0;
    car.scraping = false;
    // 고정 스텝 서브스텝 (안정성)
    const h = 1 / 120;
    let t = Math.min(dt, 0.1);
    while (t > 1e-6) {
      const s = Math.min(h, t);
      substep(car, input, s, track, ev);
      t -= s;
    }
    car.impactAcc = ev.impact;
    car.scraping = ev.scrape;
  }

  return { createCar: createCar, step: step, TUNE: TUNE };
})();

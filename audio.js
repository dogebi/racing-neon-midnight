/* Neon Midnight - audio.js
   WebAudio 절차 생성 사운드 (외부 파일 없음):
   - 엔진: 오실레이터(saw+square) — 기어 단별 RPM 상승 패턴으로 속도에 따라 피치 변화
   - 타이어 스핀: 화이트노이즈 → 밴드패스 (드리프트 강도에 따른 게인)
   - 바람: 노이즈 → 로우패스 (속도 비례)
   - 부스트/충돌/스크래치: 원샷 합성
   - 터널 에코: 피드백 딜레이 웨트 토글
   전역 스크립트. */
const NMAudio = (function () {
  'use strict';

  function AudioSys() {
    this.ctx = null;
    this.muted = false;
    this.ready = false;
  }

  AudioSys.prototype.init = function () {
    if (this.ready) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain();
    this.master.gain.value = 0.7;
    this.master.connect(ctx.destination);

    // 터널 에코 (피드백 딜레이)
    this.delay = ctx.createDelay(0.5);
    this.delay.delayTime.value = 0.21;
    this.echoWet = ctx.createGain();
    this.echoWet.gain.value = 0.0;
    this.echoFb = ctx.createGain();
    this.echoFb.gain.value = 0.3;
    this.master.connect(this.delay);
    this.delay.connect(this.echoFb);
    this.echoFb.connect(this.delay);
    this.delay.connect(this.echoWet);
    this.echoWet.connect(ctx.destination);

    // ---- 엔진: saw + square (옥타브 위) → 로우패스 ----
    this.engGain = ctx.createGain();
    this.engGain.gain.value = 0.0;
    this.engFilter = ctx.createBiquadFilter();
    this.engFilter.type = 'lowpass';
    this.engFilter.frequency.value = 900;
    this.engFilter.Q.value = 2;
    this.osc1 = ctx.createOscillator();
    this.osc1.type = 'sawtooth';
    this.osc2 = ctx.createOscillator();
    this.osc2.type = 'square';
    this.oscGain2 = ctx.createGain();
    this.oscGain2.gain.value = 0.4;
    this.osc1.connect(this.engFilter);
    this.osc2.connect(this.oscGain2);
    this.oscGain2.connect(this.engFilter);
    this.engFilter.connect(this.engGain);
    this.engGain.connect(this.master);
    this.osc1.start(); this.osc2.start();
    this.osc1.frequency.value = 50; this.osc2.frequency.value = 100;

    // ---- 노이즈 버퍼 (타이어/바람 공용 소스) ----
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    function noiseSrc() {
      const src = ctx.createBufferSource();
      src.buffer = buf; src.loop = true;
      src.start();
      return src;
    }
    // 타이어 스핀
    this.tireSrc = noiseSrc();
    this.tireFilter = ctx.createBiquadFilter();
    this.tireFilter.type = 'bandpass';
    this.tireFilter.frequency.value = 760;
    this.tireFilter.Q.value = 0.9;
    this.tireGain = ctx.createGain();
    this.tireGain.gain.value = 0;
    this.tireSrc.connect(this.tireFilter);
    this.tireFilter.connect(this.tireGain);
    this.tireGain.connect(this.master);
    // 스크래치 (가드레일)
    this.scrapeFilter = ctx.createBiquadFilter();
    this.scrapeFilter.type = 'bandpass';
    this.scrapeFilter.frequency.value = 2300;
    this.scrapeFilter.Q.value = 3;
    this.scrapeGain = ctx.createGain();
    this.scrapeGain.gain.value = 0;
    this.tireSrc.connect(this.scrapeFilter);
    this.scrapeFilter.connect(this.scrapeGain);
    this.scrapeGain.connect(this.master);
    // 바람
    this.windSrc = noiseSrc();
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'lowpass';
    this.windFilter.frequency.value = 340;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    this.windSrc.connect(this.windFilter);
    this.windFilter.connect(this.windGain);
    this.windGain.connect(this.master);

    this.ready = true;
  };

  AudioSys.prototype.resume = function () {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  };

  // 기어 패턴: 속도에 따라 RPM이 구간별로 상승하는 피치
  AudioSys.prototype.update = function (dt, car, inTunnel) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const speed = car.speed;
    const maxS = NMPhysics.TUNE.maxSpeed;

    // 기어/RPM
    const gears = [0, 9, 17, 27, 38, 50, 64];
    let gear = 0;
    for (let i = gears.length - 1; i >= 0; i--) { if (speed >= gears[i]) { gear = i; break; } }
    const g0 = gears[gear], g1 = gears[Math.min(gear + 1, gears.length - 1)] || g0 + 12;
    const span = Math.max(1, g1 - g0);
    let rpm = Math.min(1, (speed - g0) / span);
    if (speed < 2 && car.engineLoad > 0) rpm = 0.35; // 정지 스로틀 레빙
    rpm = Math.min(1, rpm + car.wheelSpin * 0.25);

    const base = 46 + gear * 4;
    const freq = base + rpm * (78 + gear * 8);
    const tau = 0.06;
    this.osc1.frequency.setTargetAtTime(freq, t, tau);
    this.osc2.frequency.setTargetAtTime(freq * 2.01, t, tau);
    this.engFilter.frequency.setTargetAtTime(500 + rpm * 2100 + car.engineLoad * 500, t, tau);
    const engVol = this.muted ? 0 : (0.10 + car.engineLoad * 0.10 + rpm * 0.07 + (car.boosting ? 0.06 : 0));
    this.engGain.gain.setTargetAtTime(engVol, t, tau);

    // 타이어 스핀
    const tireVol = this.muted ? 0 : car.wheelSpin * Math.min(1, speed / 16) * 0.16;
    this.tireGain.gain.setTargetAtTime(tireVol, t, 0.09);
    this.tireFilter.frequency.setTargetAtTime(640 + car.wheelSpin * 500, t, 0.15);

    // 스크래치
    const scrapeVol = this.muted ? 0 : (car.scraping ? 0.10 : 0);
    this.scrapeGain.gain.setTargetAtTime(scrapeVol, t, 0.05);

    // 바람
    const windVol = this.muted ? 0 : Math.pow(speed / maxS, 2) * 0.10;
    this.windGain.gain.setTargetAtTime(windVol, t, 0.2);
    this.windFilter.frequency.setTargetAtTime(240 + speed * 6, t, 0.3);

    // 터널 에코
    this.echoWet.gain.setTargetAtTime(this.muted ? 0 : (inTunnel ? 0.16 : 0), t, 0.25);
  };

  // 충돌 원샷: 노이즈 버스트 + 저음 피치 드랍
  AudioSys.prototype.impact = function (strength) {
    if (!this.ready || this.muted) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const s = Math.min(1, strength / 22);
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(130 + s * 60, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.28);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.4 * (0.4 + s * 0.6), t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + 0.32);
    // 금속성 버스트
    const src = ctx.createBufferSource();
    src.buffer = this.tireSrc.buffer;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 1400 + s * 900; bp.Q.value = 1.4;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.25 * (0.5 + s * 0.5), t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    src.connect(bp); bp.connect(ng); ng.connect(this.master);
    src.start(t, Math.random() * 1.2); src.stop(t + 0.2);
  };

  // 부스트 발동 원샷
  AudioSys.prototype.boost = function () {
    if (!this.ready || this.muted) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(90, t);
    o.frequency.exponentialRampToValueAtTime(340, t + 0.35);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.16, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + 0.5);
  };

  // 랩 완료 짧은 아르페지오
  AudioSys.prototype.lap = function () {
    if (!this.ready || this.muted) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    const notes = [523, 659, 784, 1046];
    notes.forEach(function (f, i) {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = f;
      const g = ctx.createGain();
      const t = t0 + i * 0.09;
      g.gain.setValueAtTime(0.001, t);
      g.gain.linearRampToValueAtTime(0.12, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
      o.connect(g); g.connect(ctx.destination);
      o.start(t); o.stop(t + 0.3);
    });
  };

  AudioSys.prototype.setMuted = function (m) {
    this.muted = m;
    if (this.ready) {
      this.master.gain.setTargetAtTime(m ? 0 : 0.7, this.ctx.currentTime, 0.05);
    }
  };

  return { AudioSys: AudioSys };
})();

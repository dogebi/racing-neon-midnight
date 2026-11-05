/* Neon Midnight - hud.js
   속도 / 랩타임 / 드리프트 점수 / 부스트 게이지 표시. DOM 기반. */
const NMHud = (function () {
  'use strict';

  function fmtTime(sec) {
    if (sec == null || !isFinite(sec)) return '--:--.--';
    const m = Math.floor(sec / 60);
    const s = sec - m * 60;
    return m + ':' + (s < 10 ? '0' : '') + s.toFixed(2);
  }

  function Hud() {
    this.hud = document.getElementById('hud');
    this.speed = document.getElementById('speed');
    this.boostfill = document.getElementById('boostfill');
    this.laptime = document.getElementById('laptime');
    this.lapcount = document.getElementById('lapcount');
    this.bestlap = document.getElementById('bestlap');
    this.score = document.getElementById('score');
    this.driftpop = document.getElementById('driftpop');
    this.toastEl = document.getElementById('toast');
    this.overlay = document.getElementById('overlay');
    this.errbox = document.getElementById('errbox');
    this.popTimer = 0;
    this.toastTimer = 0;
    this.speedDisplay = 0;
    this.scoreDisplay = 0;
  }

  Hud.prototype.showHud = function () {
    this.hud.classList.add('on');
  };

  Hud.prototype.hideOverlay = function () {
    this.overlay.classList.add('off');
  };

  Hud.prototype.error = function (msg) {
    this.errbox.textContent = msg;
    this.errbox.style.display = 'block';
    this.overlay.classList.add('off');
  };

  Hud.prototype.toast = function (msg, dur) {
    this.toastEl.textContent = msg;
    this.toastTimer = dur || 2.2;
  };

  Hud.prototype.driftGain = function (gain, total) {
    this.driftpop.textContent = 'DRIFT +' + Math.floor(gain);
    this.driftpop.style.opacity = '0.95';
    this.popTimer = 1.1;
    this._driftTotal = total;
  };

  Hud.prototype.update = function (dt, st) {
    // 속도 (표시 스무딩)
    const target = Math.round(st.kmh);
    this.speedDisplay += (target - this.speedDisplay) * Math.min(1, dt * 10);
    if (Math.abs(target - this.speedDisplay) < 1) this.speedDisplay = target;
    this.speed.textContent = Math.round(this.speedDisplay);

    // 랩타임
    this.laptime.textContent = fmtTime(st.lapTime);
    this.lapcount.textContent = st.lapCount;
    this.bestlap.textContent = fmtTime(st.best);

    // 부스트 게이지
    this.boostfill.style.width = (st.boost * 100).toFixed(1) + '%';
    this.boostfill.style.opacity = st.boost >= 1 ? 1 : 0.75;

    // 점수 (카운트업 연출)
    this.scoreDisplay += (st.score - this.scoreDisplay) * Math.min(1, dt * 6);
    if (Math.abs(st.score - this.scoreDisplay) < 1) this.scoreDisplay = st.score;
    this.score.textContent = Math.floor(this.scoreDisplay).toLocaleString();

    // 드리프트 팝업 페이드
    if (this.popTimer > 0) {
      this.popTimer -= dt;
      this.driftpop.style.opacity = Math.max(0, this.popTimer / 1.1).toFixed(2);
    }
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      this.toastEl.style.opacity = Math.min(1, this.toastTimer / 0.5).toFixed(2);
    } else {
      this.toastEl.style.opacity = '0';
    }
  };

  Hud.fmtTime = fmtTime;

  return { Hud: Hud, fmtTime: fmtTime };
})();

(function () {
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ----- drifting air motes -----
  const motesEl = document.querySelector(".motes");
  if (motesEl && !reduceMotion) {
    const count = window.innerWidth < 720 ? 14 : 26;
    for (let i = 0; i < count; i++) {
      const m = document.createElement("span");
      m.className = "mote";
      const size = 2 + Math.random() * 6;
      m.style.width = `${size}px`;
      m.style.height = `${size}px`;
      m.style.left = `${Math.random() * 100}%`;
      m.style.setProperty("--drift-x", `${(Math.random() - 0.5) * 200}px`);
      const duration = 18 + Math.random() * 30;
      m.style.animationDuration = `${duration}s`;
      m.style.animationDelay = `-${Math.random() * duration}s`;
      m.style.opacity = (0.4 + Math.random() * 0.5).toString();
      motesEl.appendChild(m);
    }
  }

  // ----- generated waveform for the "latest track" player -----
  const wave = document.querySelector(".waveform");
  const BAR_COUNT = 64;
  if (wave) {
    // a low-rolling envelope so it reads as music, not noise
    for (let i = 0; i < BAR_COUNT; i++) {
      const bar = document.createElement("span");
      bar.className = "bar";
      const t = i / BAR_COUNT;
      const envelope = Math.sin(t * Math.PI) * 0.7 + 0.25;
      const wobble = Math.sin(i * 0.9) * 0.15 + Math.sin(i * 0.27) * 0.18;
      const h = Math.max(0.12, Math.min(1, envelope + wobble + Math.random() * 0.12));
      bar.style.height = `${h * 100}%`;
      wave.appendChild(bar);
    }
  }

  // ----- fake playback state -----
  const playBtn = document.querySelector(".play");
  const iconPlay = document.querySelector(".icon-play");
  const iconPause = document.querySelector(".icon-pause");
  const elapsedEl = document.querySelector(".elapsed");
  const totalEl = document.querySelector(".total");
  const TRACK_LENGTH = 4 * 60 + 38; // 4:38
  let elapsed = 0;
  let playing = false;
  let rafId = null;
  let lastTick = 0;

  function fmt(seconds) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60)
      .toString()
      .padStart(2, "0");
    return `${m}:${s}`;
  }

  function paintProgress() {
    if (!wave) return;
    const bars = wave.querySelectorAll(".bar");
    const progress = elapsed / TRACK_LENGTH;
    bars.forEach((b, i) => {
      const p = i / bars.length;
      b.classList.toggle("played", p <= progress);
    });
  }

  function tick(now) {
    if (!playing) return;
    if (!lastTick) lastTick = now;
    const dt = (now - lastTick) / 1000;
    lastTick = now;
    elapsed = Math.min(TRACK_LENGTH, elapsed + dt);
    elapsedEl.textContent = fmt(elapsed);
    paintProgress();
    if (elapsed >= TRACK_LENGTH) {
      stop();
      return;
    }
    rafId = requestAnimationFrame(tick);
  }

  function start() {
    playing = true;
    lastTick = 0;
    playBtn.setAttribute("aria-pressed", "true");
    playBtn.setAttribute("aria-label", "pause understory");
    iconPlay.style.display = "none";
    iconPause.style.display = "";
    rafId = requestAnimationFrame(tick);
  }

  function stop() {
    playing = false;
    playBtn.setAttribute("aria-pressed", "false");
    playBtn.setAttribute("aria-label", "play understory");
    iconPlay.style.display = "";
    iconPause.style.display = "none";
    if (rafId) cancelAnimationFrame(rafId);
  }

  if (playBtn && elapsedEl && totalEl) {
    totalEl.textContent = fmt(TRACK_LENGTH);
    elapsedEl.textContent = fmt(0);
    playBtn.addEventListener("click", () => {
      if (playing) stop();
      else start();
    });

    // let users scrub by clicking the waveform
    if (wave) {
      wave.addEventListener("click", (e) => {
        const rect = wave.getBoundingClientRect();
        const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
        elapsed = ratio * TRACK_LENGTH;
        elapsedEl.textContent = fmt(elapsed);
        paintProgress();
      });
    }
  }
})();

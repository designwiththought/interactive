/* Border Radius — shared behavior used by index.html and tip pages.
   Each piece self-guards: it only runs if its elements exist on the page. */
(function () {
  // ===== Theme toggle =====
  const docEl = document.documentElement;
  const themeToggle = document.getElementById('themeToggle');
  if (themeToggle) {
    const iconSun = document.getElementById('iconSun');
    const iconMoon = document.getElementById('iconMoon');
    const sync = () => {
      const dark = docEl.getAttribute('data-theme') === 'dark';
      if (iconSun) iconSun.style.display = dark ? 'block' : 'none';
      if (iconMoon) iconMoon.style.display = dark ? 'none' : 'block';
    };
    sync();
    themeToggle.addEventListener('click', () => {
      const dark = docEl.getAttribute('data-theme') === 'dark';
      if (dark) {
        docEl.removeAttribute('data-theme');
        try { localStorage.setItem('borderradius-theme', 'light'); } catch (e) {}
      } else {
        docEl.setAttribute('data-theme', 'dark');
        try { localStorage.setItem('borderradius-theme', 'dark'); } catch (e) {}
      }
      sync();
    });
  }

  // ===== Radius playground (present on the home page + the namesake tip) =====
  const slider = document.getElementById('radiusSlider');
  if (slider) {
    const shape = document.getElementById('playShape');
    const shapeVal = document.getElementById('shapeVal');
    const sliderVal = document.getElementById('sliderVal');
    const codeVal = document.getElementById('codeVal');
    const copyBtn = document.getElementById('copyBtn');
    const apply = (px) => {
      const v = px + 'px';
      if (shape) shape.style.borderRadius = v;
      if (shapeVal) shapeVal.textContent = v;
      if (sliderVal) sliderVal.textContent = px;
      if (codeVal) codeVal.textContent = v;
    };
    slider.addEventListener('input', () => apply(slider.value));
    apply(slider.value);
    if (copyBtn) {
      copyBtn.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(`border-radius: ${slider.value}px;`); } catch (e) {}
        copyBtn.textContent = 'Copied!';
        copyBtn.classList.add('done');
        setTimeout(() => { copyBtn.textContent = 'Copy'; copyBtn.classList.remove('done'); }, 1400);
      });
    }
  }

  // ===== Latest-episode play toggle (simulated) =====
  const epPlay = document.getElementById('epPlay');
  if (epPlay) {
    const epPlayIcon = document.getElementById('epPlayIcon');
    const epPauseIcon = document.getElementById('epPauseIcon');
    const epCard = epPlay.closest('.pod-episode');
    epPlay.addEventListener('click', () => {
      const playing = epCard.classList.toggle('playing');
      if (epPlayIcon) epPlayIcon.style.display = playing ? 'none' : 'block';
      if (epPauseIcon) epPauseIcon.style.display = playing ? 'block' : 'none';
    });
  }

  // ===== Signup =====
  const signup = document.getElementById('signup');
  if (signup) {
    signup.addEventListener('submit', (e) => {
      e.preventDefault();
      const email = document.getElementById('email').value.trim();
      const msg = document.getElementById('msg');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        msg.style.color = 'var(--riso-red)';
        msg.textContent = 'Hmm — that doesn’t look like a real address.';
        return;
      }
      msg.style.color = 'var(--riso-green)';
      msg.textContent = `You’re in, ${email.split('@')[0]} — the next issue lands Tuesday.`;
      document.getElementById('email').value = '';
    });
  }

  // ===== Reveal on scroll =====
  const io = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
    });
  }, { threshold: 0.12 });
  document.querySelectorAll('.reveal').forEach((el) => io.observe(el));

  // ===== Year =====
  const y = document.getElementById('year');
  if (y) y.textContent = new Date().getFullYear();
})();

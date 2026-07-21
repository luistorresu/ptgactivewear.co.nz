(() => {
  const STORAGE_KEY = 'ptg-theme';
  const THEMES = new Set(['light', 'dark', 'sky']);
  const LABELS = { light: 'Light', dark: 'Dark', sky: 'Sky Blue' };
  const LOGOS = {
    light: '/photos/ptg-logo-dark-transparent.webp',
    dark: '/photos/ptg-logo-light-transparent.webp',
    sky: '/photos/ptg-logo-light-transparent.webp'
  };
  const THEME_COLOURS = { light: '#ffffff', dark: '#0b1117', sky: '#dff3fa' };

  function savedTheme() {
    try {
      const value = localStorage.getItem(STORAGE_KEY);
      return THEMES.has(value) ? value : '';
    } catch (error) {
      return '';
    }
  }

  function updateControls(theme) {
    document.querySelectorAll('[data-theme-select]').forEach(select => {
      select.value = theme;
      select.setAttribute('aria-description', `Current theme: ${LABELS[theme]}`);
    });
    document.querySelectorAll('[data-theme-label]').forEach(label => {
      label.textContent = LABELS[theme];
    });
    document.querySelectorAll('[data-theme-logo]').forEach(logo => {
      logo.src = LOGOS[theme];
    });
    const themeColour = document.querySelector('meta[name="theme-color"]');
    if (themeColour) themeColour.content = THEME_COLOURS[theme];
  }

  function applyTheme(value, persist = false) {
    const theme = THEMES.has(value) ? value : 'light';
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme === 'dark' ? 'dark' : 'light';
    updateControls(theme);

    if (persist) {
      try {
        localStorage.setItem(STORAGE_KEY, theme);
      } catch (error) {
        // The theme still applies when browser storage is unavailable.
      }
    }

    document.dispatchEvent(new CustomEvent('ptg:themechange', { detail: { theme } }));
    return theme;
  }

  function setupFloatingFootball() {
    const header = document.querySelector('.site-header');
    if (!header || header.querySelector('.floating-football-animation')) return;

    const stage = document.createElement('div');
    const runner = document.createElement('span');
    const ball = document.createElement('img');
    stage.className = 'floating-football-animation';
    stage.setAttribute('aria-hidden', 'true');
    runner.className = 'floating-football-runner';
    ball.className = 'floating-football';
    ball.src = '/assets/images/soccer-ball.svg';
    ball.alt = '';
    ball.width = 64;
    ball.height = 64;
    ball.decoding = 'async';
    runner.append(ball);
    stage.append(runner);
    header.append(stage);

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let motion;
    let resizeTimer;

    const randomPoint = () => {
      const size = runner.getBoundingClientRect().width || 36;
      const padding = 6;
      const maxX = Math.max(padding, stage.clientWidth - size - padding);
      const maxY = Math.max(padding, stage.clientHeight - size - padding);
      return {
        x: padding + Math.random() * Math.max(0, maxX - padding),
        y: padding + Math.random() * Math.max(0, maxY - padding)
      };
    };

    const startMotion = () => {
      motion?.cancel();
      if (reducedMotion.matches || !runner.animate) return;
      const points = Array.from({ length: 7 }, randomPoint);
      const direction = Math.random() > 0.5 ? 1 : -1;
      const turns = 3 + Math.floor(Math.random() * 3);
      motion = runner.animate(points.map((point, index) => ({
        transform: `translate3d(${point.x}px, ${point.y}px, 0) rotate(${direction * turns * 360 * index / (points.length - 1)}deg)`,
        easing: 'ease-in-out'
      })), {
        duration: 36000 + Math.random() * 12000,
        iterations: 1,
        fill: 'forwards'
      });
      if (document.hidden) motion.pause();
      motion.finished.then(startMotion).catch(() => {});
    };

    document.addEventListener('visibilitychange', () => {
      if (!motion) return;
      if (document.hidden) motion.pause();
      else motion.play();
    });
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(startMotion, 180);
    });
    reducedMotion.addEventListener('change', startMotion);
    requestAnimationFrame(startMotion);
  }

  const initialTheme = applyTheme(savedTheme() || 'light');

  document.addEventListener('DOMContentLoaded', () => {
    updateControls(initialTheme);
    setupFloatingFootball();
    document.querySelectorAll('[data-theme-select]').forEach(select => {
      select.addEventListener('change', event => applyTheme(event.target.value, true));
    });
  });

  window.addEventListener('storage', event => {
    if (event.key === STORAGE_KEY) applyTheme(THEMES.has(event.newValue) ? event.newValue : 'light');
  });

  window.PTGTheme = Object.freeze({ apply: theme => applyTheme(theme, true), current: () => document.documentElement.dataset.theme });
})();

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

  const initialTheme = applyTheme(savedTheme() || 'light');

  document.addEventListener('DOMContentLoaded', () => {
    updateControls(initialTheme);
    document.querySelectorAll('[data-theme-select]').forEach(select => {
      select.addEventListener('change', event => applyTheme(event.target.value, true));
    });
  });

  window.addEventListener('storage', event => {
    if (event.key === STORAGE_KEY) applyTheme(THEMES.has(event.newValue) ? event.newValue : 'light');
  });

  window.PTGTheme = Object.freeze({ apply: theme => applyTheme(theme, true), current: () => document.documentElement.dataset.theme });
})();

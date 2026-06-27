import { ContactRelationshipApp } from './app.js';
import { applyMixin } from './apply-mixin.js';
import { Palette } from './palette.js';

const THEME_KEY = 'contacts-graph:theme';

/**
 * Light / dark theme. The themes are pure CSS (`:root` vs
 * `:root[data-theme='light']` in styles.css); this just flips the attribute on
 * <html>, persists the choice, and re-reads the palette so the D3 graph (whose
 * node/edge colors are built in JS from the CSS tokens) recolors to match.
 */
class ThemeMixin {
  _applyInitialTheme() {
    let theme = 'dark';
    try {
      const saved = localStorage.getItem(THEME_KEY);
      if (saved === 'light' || saved === 'dark') theme = saved;
    } catch {
      // localStorage unavailable — fall back to dark.
    }
    // Set before the graph is created so it builds with the right colors; no
    // re-render needed yet.
    this._setTheme(theme, { persist: false, rerender: false });
  }

  _toggleTheme() {
    const current = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
    this._setTheme(current === 'light' ? 'dark' : 'light');
  }

  _setTheme(theme, { persist = true, rerender = true } = {}) {
    document.documentElement.dataset.theme = theme;
    if (persist) {
      try {
        localStorage.setItem(THEME_KEY, theme);
      } catch {
        // ignore persistence failure
      }
    }
    Palette.refresh();
    if (rerender && this.graph) {
      this.graph.refreshColors();
      this._renderLegend();
    }
    this._updateThemeToggleButton(theme);
  }

  _updateThemeToggleButton(theme) {
    const btn = document.getElementById('btn-theme-toggle');
    if (!btn) return;
    // Label shows the theme you'll switch TO.
    btn.textContent = theme === 'light' ? '☾ Dark' : '☀ Light';
    btn.title = theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme';
  }
}

applyMixin(ContactRelationshipApp.prototype, ThemeMixin);

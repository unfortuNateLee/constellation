/**
 * Palette — reads the category colors from the CSS `:root` custom properties so
 * the stylesheet is the single source of truth. graph.js (node/edge/legend
 * colors) and app.js (tag dots, filter accents) both consume this instead of
 * hardcoding hex values that used to drift out of sync with the CSS.
 *
 * Values are read once (getComputedStyle) and cached. Outside a browser (e.g.
 * the Node test harness, where there is no real stylesheet) every lookup falls
 * back to a neutral gray — colors aren't asserted there.
 */
export class Palette {
  static NEUTRAL = '#8395a7';
  static _cache = null;

  static _read() {
    if (this._cache) return this._cache;
    const css =
      typeof getComputedStyle !== 'undefined' && typeof document !== 'undefined'
        ? getComputedStyle(document.documentElement)
        : null;
    const v = (name) => {
      const raw = css ? css.getPropertyValue(name).trim() : '';
      return raw || this.NEUTRAL;
    };
    this._cache = {
      category: {
        family: v('--cat-family'),
        friend: v('--cat-friend'),
        mitre: v('--cat-mitre'),
        work: v('--cat-work'),
        neighbor: v('--cat-neighbor'),
        church: v('--cat-church'),
        school: v('--cat-school'),
        medical: v('--cat-medical'),
        company: v('--cat-company'),
        virtual: v('--cat-virtual'),
        other: v('--cat-other'),
      },
      nodeDefault: v('--cat-node-default'),
      group: v('--cat-group'),
      selected: v('--cat-selected'),
      inferred: v('--cat-edge-inferred'),
    };
    return this._cache;
  }

  /** Color for a named category (family, work, …); NEUTRAL if unknown. */
  static category(name) {
    return this._read().category[name] || this.NEUTRAL;
  }

  /** Graph node fill for a category, with group/default fallbacks. */
  static node(category) {
    const p = this._read();
    return p.category[category] || p.nodeDefault;
  }

  static get nodeDefault() {
    return this._read().nodeDefault;
  }
  static get group() {
    return this._read().group;
  }
  static get selected() {
    return this._read().selected;
  }
  static get inferred() {
    return this._read().inferred;
  }
}

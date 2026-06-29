import { ContactRelationshipApp } from './app.js';
import { applyMixin } from './apply-mixin.js';
import { Palette } from './palette.js';

/**
 * Sidebar: the contact list, category/tag filters, tag colors, stats, legend,
 * "me" self-contact picker, sidebar collapse, and graph resize scheduling.
 * Extracted from app.js verbatim.
 */
class SidebarMixin {
  _renderContactList() {
    const list = document.getElementById('contact-list');
    list.innerHTML = '';
    const contacts = this._filteredContactsForSidebar();

    const frag = document.createDocumentFragment();
    for (const c of contacts) {
      const item = document.createElement('div');
      item.className = `contact-item category-${c.category}`;
      item.dataset.id = c.id;
      const tagColors = this._contactListColors(c);
      const accent = tagColors[0] || '#8395a7';
      const soft = this._withAlpha(accent, 0.18);
      item.style.setProperty('--contact-accent', accent);
      item.style.setProperty('--contact-accent-soft', soft);

      // Checkbox for multi-select export
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'contact-export-cb';
      cb.checked = this._selectedForExport.has(c.id);
      cb.addEventListener('change', (e) => {
        e.stopPropagation();
        if (cb.checked) this._selectedForExport.add(c.id);
        else this._selectedForExport.delete(c.id);
        this._updateExportBar();
      });
      cb.addEventListener('click', (e) => e.stopPropagation());

      const dot = document.createElement('span');
      dot.className = 'contact-dot';
      dot.style.background = this._contactListDotFill(tagColors);

      const info = document.createElement('div');
      info.className = 'contact-info';

      const name = document.createElement('div');
      name.className = 'contact-name';
      name.textContent = this._formatContactListName(c);

      const sub = document.createElement('div');
      sub.className = 'contact-sub';
      sub.textContent = c.org || c.category;

      info.appendChild(name);
      info.appendChild(sub);
      item.appendChild(cb);
      item.appendChild(dot);
      item.appendChild(info);

      item.addEventListener('click', () => {
        this.graph.highlightContact(c.id);
        this._onNodeSelect(c);
      });

      frag.appendChild(item);
    }

    list.appendChild(frag);

    document.getElementById('list-count').textContent =
      `${contacts.length} contact${contacts.length !== 1 ? 's' : ''}`;
  }

  _filteredContactsForSidebar() {
    let contacts = this.graphData.nodes
      .filter((n) => !n.isVirtual && !n.isGroupNode)
      .sort((a, b) => this._contactListSortKey(a).localeCompare(this._contactListSortKey(b)));

    if (this._searchQuery) {
      const q = this._searchQuery;
      contacts = contacts.filter(
        (c) =>
          (c.name || '').toLowerCase().includes(q) ||
          this._formatContactListName(c, 'last-first').toLowerCase().includes(q) ||
          (c.org || '').toLowerCase().includes(q) ||
          (c.title || '').toLowerCase().includes(q) ||
          (c.notes || []).join('\n').toLowerCase().includes(q),
      );
    }

    if (this._activeFilters.size > 0) {
      contacts = contacts.filter((c) =>
        (c.filterTags || []).some((tag) => this._activeFilters.has(tag)),
      );
    }
    return contacts;
  }

  _contactListColors(contact) {
    const preferredOrder = ['family', 'company', 'virtual', 'other'];
    const tags = Array.from(new Set(contact.filterTags || []));
    tags.sort((a, b) => {
      const ai = preferredOrder.indexOf(a);
      const bi = preferredOrder.indexOf(b);
      if (ai !== -1 || bi !== -1) {
        return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
      }
      return a.localeCompare(b);
    });
    const colors = tags.map((tag) => this._tagColor(tag)).filter(Boolean);
    return colors.length ? colors.slice(0, 4) : ['#8395a7'];
  }

  _contactListDotFill(colors) {
    if (!colors || colors.length === 0) return '#8395a7';
    if (colors.length === 1) return colors[0];
    const stops = colors.map((color, idx) => {
      const start = Math.round((idx / colors.length) * 100);
      const end = Math.round(((idx + 1) / colors.length) * 100);
      return `${color} ${start}% ${end}%`;
    });
    return `linear-gradient(135deg, ${stops.join(', ')})`;
  }

  _tagColor(tag) {
    // Known categories come from the shared CSS palette (single source).
    if (['family', 'company', 'virtual', 'other'].includes(tag)) {
      return Palette.category(tag);
    }

    // Stable color for user hashtags.
    let hash = 0;
    for (let i = 0; i < tag.length; i++) {
      hash = (hash * 31 + tag.charCodeAt(i)) >>> 0;
    }
    const hue = hash % 360;
    const sat = 58 + (hash % 14);
    const light = 58 + ((hash >> 3) % 10);
    return `hsl(${hue}deg ${sat}% ${light}%)`;
  }

  _withAlpha(color, alpha) {
    if (!color) return `rgba(131, 149, 167, ${alpha})`;
    if (color.startsWith('#')) {
      const hex = color.slice(1);
      const normalized =
        hex.length === 3
          ? hex
              .split('')
              .map((ch) => ch + ch)
              .join('')
          : hex.padEnd(6, '0').slice(0, 6);
      const int = parseInt(normalized, 16);
      const r = (int >> 16) & 255;
      const g = (int >> 8) & 255;
      const b = int & 255;
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
    const hslMatch = color.match(/^hsl\(\s*([0-9.]+)(?:deg)?\s+([0-9.]+)%\s+([0-9.]+)%\s*\)$/i);
    if (hslMatch) {
      return `hsla(${hslMatch[1]}deg ${hslMatch[2]}% ${hslMatch[3]}% / ${alpha})`;
    }
    return color;
  }

  _bestTextColor(color) {
    const rgb = this._colorToRgb(color);
    if (!rgb) return '#fff';
    const luminance = (0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) / 255;
    return luminance > 0.66 ? '#111' : '#fff';
  }

  _colorToRgb(color) {
    if (!color) return null;
    if (color.startsWith('#')) {
      const hex = color.slice(1);
      const normalized =
        hex.length === 3
          ? hex
              .split('')
              .map((ch) => ch + ch)
              .join('')
          : hex.padEnd(6, '0').slice(0, 6);
      const int = parseInt(normalized, 16);
      return {
        r: (int >> 16) & 255,
        g: (int >> 8) & 255,
        b: int & 255,
      };
    }
    const hslMatch = color.match(/^hsl\(\s*([0-9.]+)(?:deg)?\s+([0-9.]+)%\s+([0-9.]+)%\s*\)$/i);
    if (!hslMatch) return null;
    const h = Number(hslMatch[1]) % 360;
    const s = Number(hslMatch[2]) / 100;
    const l = Number(hslMatch[3]) / 100;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;
    let r1 = 0,
      g1 = 0,
      b1 = 0;
    if (h < 60) [r1, g1, b1] = [c, x, 0];
    else if (h < 120) [r1, g1, b1] = [x, c, 0];
    else if (h < 180) [r1, g1, b1] = [0, c, x];
    else if (h < 240) [r1, g1, b1] = [0, x, c];
    else if (h < 300) [r1, g1, b1] = [x, 0, c];
    else [r1, g1, b1] = [c, 0, x];
    return {
      r: Math.round((r1 + m) * 255),
      g: Math.round((g1 + m) * 255),
      b: Math.round((b1 + m) * 255),
    };
  }

  // ── Category Filters ───────────────────────────────────────────

  _renderCategoryFilters() {
    const container = document.getElementById('category-filters');
    container.innerHTML = '';

    const CATEGORY_LABELS = {
      family: 'My Family',
      company: 'Company',
      virtual: 'Virtual',
      other: 'None',
    };

    const counts = {};
    for (const n of this.graphData.nodes) {
      for (const tag of n.filterTags || []) {
        counts[tag] = (counts[tag] || 0) + 1;
      }
    }

    for (const cat of this.allCategories) {
      const label = CATEGORY_LABELS[cat] || `#${cat}`;
      const count = counts[cat] || 0;
      const accent = this._tagColor(cat);

      const btn = document.createElement('button');
      btn.className = `filter-btn category-${cat}`;
      btn.dataset.cat = cat;
      btn.style.setProperty('--filter-accent', accent);
      btn.style.setProperty('--filter-active-fg', this._bestTextColor(accent));
      btn.innerHTML = `<span class="filter-dot"></span>${label} <span class="filter-count">${count}</span>`;
      if (this._activeFilters.has(cat)) btn.classList.add('active');
      if (cat === 'family' && !this._selfContactId) btn.title = 'Choose "me" to enable My Family';

      btn.addEventListener('click', () => {
        if (cat === 'family' && !this._selfContactId) {
          this._showToast('Choose "me" first to use My Family', 'error');
          return;
        }
        if (this._activeFilters.has(cat)) {
          this._activeFilters.delete(cat);
          btn.classList.remove('active');
        } else {
          this._activeFilters.add(cat);
          btn.classList.add('active');
        }
        this.graph.setFilterCategories(Array.from(this._activeFilters));
        this._renderContactList();
      });

      container.appendChild(btn);
    }
  }

  _availableFilterTags(nodes) {
    const system = ['family', 'company', 'virtual', 'other'];
    const available = new Set(system);
    const dynamic = new Set();

    for (const n of nodes) {
      for (const tag of n.filterTags || []) {
        if (system.includes(tag)) available.add(tag);
        else dynamic.add(tag);
      }
    }
    return [...system, ...Array.from(dynamic).sort((a, b) => a.localeCompare(b))];
  }

  _renderSelfContactPicker() {
    const select = document.getElementById('self-contact-select');
    const help = document.getElementById('self-contact-help');
    const prev = this._selfContactId || '';

    select.innerHTML = '<option value="">Choose "me" contact…</option>';
    const sorted = [...this.contacts].sort((a, b) => a.fn.localeCompare(b.fn));
    for (const c of sorted) {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = c.fn;
      select.appendChild(opt);
    }

    if (prev && this._contact(prev)) {
      select.value = prev;
      const me = this._contact(prev);
      help.textContent = me
        ? `My Family is the explicit relationship network connected to ${me.fn}.`
        : 'My Family includes any contact connected to "me" by explicit relationships at any distance.';
    } else {
      this._selfContactId = null;
      select.value = '';
      help.textContent =
        'My Family includes any contact connected to "me" by explicit relationships at any distance.';
    }
  }

  _pruneActiveFilters() {
    const allowed = new Set(this.allCategories);
    for (const tag of [...this._activeFilters]) {
      if (!allowed.has(tag) || (tag === 'family' && !this._selfContactId)) {
        this._activeFilters.delete(tag);
      }
    }
  }

  // ── Stats ──────────────────────────────────────────────────────

  _renderStats(stats) {
    document.getElementById('stat-contacts').textContent = stats.totalContacts;
    document.getElementById('stat-nodes').textContent = stats.visibleNodes;
    document.getElementById('stat-edges').textContent = stats.edges;

    const explicitEdges = (this.graphData.edges || []).reduce(
      (count, edge) => count + (edge.inferred ? 0 : 1),
      0,
    );
    document.getElementById('stat-explicit').textContent = explicitEdges;
  }

  _renderLegend() {
    const itemsEl = document.getElementById('legend-items');
    if (!itemsEl) return;
    itemsEl.innerHTML = '';

    let items = this.graph.getLegend(this._graphMode);
    if (this._graphMode === 'connections') {
      if (!this._showLikelyFamily) {
        items = items.filter((item) => item.label !== 'Likely family');
      }
      if (!this._showLikelyConnections) {
        items = items.filter((item) => item.label !== 'Likely connection');
      }
      if (!this._showLikelyFamily && !this._showLikelyConnections) {
        items = items.filter((item) => item.label !== 'Likely cluster hull');
      }
      if (!this._showInferred) {
        items = items.filter((item) => item.label !== 'Organization cluster');
      }
    }
    for (const item of items) {
      const row = document.createElement('div');
      row.className = 'legend-item';
      const swatch = document.createElement('span');
      swatch.className = item.type === 'line' ? 'legend-line' : 'legend-dot';
      if (item.type === 'hull') swatch.className = 'legend-hull';
      if (item.style) swatch.style.cssText = item.style;
      else if (item.color) swatch.style.background = item.color;
      row.appendChild(swatch);
      row.appendChild(document.createTextNode(item.label));
      itemsEl.appendChild(row);
    }
  }

  _syncGraphModeControls() {
    const modeSelect = document.getElementById('graph-mode-select');
    const inferredToggle = document.getElementById('toggle-inferred');
    if (modeSelect) modeSelect.value = this._graphMode;
    if (!inferredToggle) return;
    const likelyFamilyToggle = document.getElementById('toggle-likely-family');
    const likelyConnectionsToggle = document.getElementById('toggle-likely-connections');
    const orgEnabled = this._graphMode === 'connections';
    inferredToggle.disabled = !orgEnabled;
    const orgRow = inferredToggle.closest('.toggle-row');
    if (orgRow) orgRow.classList.toggle('disabled', !orgEnabled);
    if (likelyFamilyToggle) {
      likelyFamilyToggle.disabled = !orgEnabled;
      const likelyFamilyRow = likelyFamilyToggle.closest('.toggle-row');
      if (likelyFamilyRow) likelyFamilyRow.classList.toggle('disabled', !orgEnabled);
    }
    if (likelyConnectionsToggle) {
      likelyConnectionsToggle.disabled = !orgEnabled;
      const likelyConnectionsRow = likelyConnectionsToggle.closest('.toggle-row');
      if (likelyConnectionsRow) likelyConnectionsRow.classList.toggle('disabled', !orgEnabled);
    }
  }

  _applySidebarCollapseState() {
    const sidebar = document.querySelector('.sidebar');
    const btn = document.getElementById('btn-toggle-sidebar-controls');
    const icon = btn?.querySelector('.sidebar-collapse-icon');
    if (sidebar) sidebar.classList.toggle('collapsed', this._sidebarControlsCollapsed);
    if (btn) {
      const collapsed = this._sidebarControlsCollapsed;
      btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      btn.setAttribute('title', collapsed ? 'Expand settings panel' : 'Collapse settings panel');
      btn.setAttribute(
        'aria-label',
        collapsed ? 'Expand settings panel' : 'Collapse settings panel',
      );
    }
    if (icon) icon.textContent = this._sidebarControlsCollapsed ? '›' : '‹';
    this._scheduleGraphResize();
  }

  _scheduleGraphResize() {
    window.dispatchEvent(new Event('resize'));
    window.setTimeout(() => window.dispatchEvent(new Event('resize')), 240);
  }
}

applyMixin(ContactRelationshipApp.prototype, SidebarMixin);

/**
 * SearchableSelect — progressively enhances a native <select> into a
 * type-to-filter combobox while keeping the <select> as the single source of
 * truth. Reading `select.value` and listening for its `change` event keep
 * working unchanged, so existing call sites only need one `makeSearchable(select)`
 * call after the options are in place (and again after repopulating them).
 *
 * The native <select> is hidden but stays in the DOM as the value holder. A
 * text input drives filtering; a floating list shows matches. Subtype options
 * indented with non-breaking spaces (the relationship-type picker) keep their
 * indentation in the list, while the chosen value shows un-indented in the box.
 */

const ACTIVE_CLASS = 'searchable-item-active';
let comboCounter = 0;

class SearchableSelect {
  constructor(select, opts = {}) {
    this.select = select;
    this.placeholder = opts.placeholder || 'Type to search…';
    this._items = [];
    this.activeIndex = -1;
    this._build();
  }

  _build() {
    const select = this.select;
    select.classList.add('searchable-native');
    select.setAttribute('tabindex', '-1');
    select.setAttribute('aria-hidden', 'true');

    const wrap = document.createElement('div');
    wrap.className = 'searchable-select';
    // Works on a detached <select> too: if it has a parent, slot the wrapper in
    // place; otherwise the caller is responsible for inserting wrap (= the
    // select's new parent) into the DOM.
    if (select.parentNode) select.parentNode.insertBefore(wrap, select);
    wrap.appendChild(select);

    const listId = `searchable-list-${++comboCounter}`;
    this._listId = listId;

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'form-control searchable-input';
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-expanded', 'false');
    input.setAttribute('aria-controls', listId);
    input.autocomplete = 'off';
    input.placeholder = this.placeholder;
    wrap.appendChild(input);

    const list = document.createElement('ul');
    list.className = 'searchable-list hidden';
    list.id = listId;
    list.setAttribute('role', 'listbox');
    wrap.appendChild(list);

    this.wrap = wrap;
    this.input = input;
    this.list = list;

    input.addEventListener('focus', () => {
      input.select();
      this._filter('');
    });
    input.addEventListener('input', () => this._filter(input.value));
    input.addEventListener('keydown', (e) => this._onKey(e));

    this._onDocPointer = (e) => {
      // Self-clean if our wrapper was removed from the DOM (e.g. a re-render),
      // so re-created comboboxes don't leak document listeners.
      if (!wrap.isConnected) {
        document.removeEventListener('mousedown', this._onDocPointer);
        return;
      }
      if (!wrap.contains(e.target)) this.close();
    };
    document.addEventListener('mousedown', this._onDocPointer);

    // Keep the display in sync when the value is changed elsewhere.
    select.addEventListener('change', () => {
      if (!this._selfChange) this._syncDisplay();
    });

    this._syncDisplay();
  }

  _options() {
    return Array.from(this.select.options);
  }

  /** Plain label for an option (collapses indentation for the input box). */
  _labelOf(opt) {
    return opt.textContent.replace(/\u00A0/g, ' ').trim();
  }

  _syncDisplay() {
    const opt = this.select.selectedOptions[0];
    this.input.value = !opt || opt.value === '' ? '' : this._labelOf(opt);
  }

  _filter(query) {
    const q = query.trim().toLowerCase();
    const list = this.list;
    list.innerHTML = '';
    this._items = [];
    this._options().forEach((opt, idx) => {
      const label = this._labelOf(opt);
      if (q && !label.toLowerCase().includes(q)) return;
      const li = document.createElement('li');
      li.className = 'searchable-item';
      li.id = `${this._listId}-opt-${idx}`;
      li.setAttribute('role', 'option');
      const selected = opt.value === this.select.value;
      li.setAttribute('aria-selected', selected ? 'true' : 'false');
      li.textContent = opt.textContent; // preserve subtype indentation
      li.dataset.index = String(idx);
      if (selected) li.classList.add('searchable-item-selected');
      li.addEventListener('mousedown', (e) => {
        e.preventDefault();
        this._choose(idx);
      });
      list.appendChild(li);
      this._items.push(li);
    });
    this.activeIndex = this._items.length ? 0 : -1;
    this._highlight();
    const hasItems = this._items.length > 0;
    list.classList.toggle('hidden', !hasItems);
    this.input.setAttribute('aria-expanded', hasItems ? 'true' : 'false');
  }

  _highlight() {
    this._items.forEach((li, i) => li.classList.toggle(ACTIVE_CLASS, i === this.activeIndex));
    const active = this._items[this.activeIndex];
    if (active) {
      active.scrollIntoView({ block: 'nearest' });
      this.input.setAttribute('aria-activedescendant', active.id);
    } else {
      this.input.removeAttribute('aria-activedescendant');
    }
  }

  _move(delta) {
    if (!this._items.length) return;
    this.activeIndex = (this.activeIndex + delta + this._items.length) % this._items.length;
    this._highlight();
  }

  _choose(idx) {
    const opt = this.select.options[idx];
    if (!opt) return;
    this.select.value = opt.value;
    this._syncDisplay();
    this.close();
    this._selfChange = true;
    this.select.dispatchEvent(new Event('change', { bubbles: true }));
    this._selfChange = false;
  }

  _onKey(e) {
    const open = !this.list.classList.contains('hidden');
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (!open) this._filter(this.input.value);
        else this._move(1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        this._move(-1);
        break;
      case 'Enter':
        if (open && this.activeIndex >= 0) {
          e.preventDefault();
          this._choose(Number(this._items[this.activeIndex].dataset.index));
        }
        break;
      case 'Escape':
        if (open) {
          e.preventDefault();
          this.close();
        }
        break;
      default:
        break;
    }
  }

  open() {
    this._filter(this.input.value);
  }

  close() {
    this.list.classList.add('hidden');
    this.input.setAttribute('aria-expanded', 'false');
    this.input.removeAttribute('aria-activedescendant');
    this._syncDisplay();
  }

  /** Re-sync the display after the underlying <select>'s options/value change. */
  refresh() {
    this._syncDisplay();
  }
}

/**
 * Enhance a <select> in place (idempotent). Returns the SearchableSelect.
 * Call again after repopulating the select's options to re-sync the display.
 */
export function makeSearchable(select, opts = {}) {
  if (!select) return null;
  if (select._searchable) {
    select._searchable.refresh();
    return select._searchable;
  }
  const inst = new SearchableSelect(select, opts);
  select._searchable = inst;
  return inst;
}

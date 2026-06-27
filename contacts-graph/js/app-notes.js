/**
 * Notes editing, inline save, and hashtag autocomplete behavior.
 * Loaded after app.js and attached mechanically to ContactRelationshipApp.
 */
Object.assign(ContactRelationshipApp.prototype, {
  _bindNotesAutocomplete(textarea, inlineSave, contactId) {
    textarea.oninput = () => {
      if (inlineSave) this._scheduleInlineNotesSave(contactId, textarea.value);
      this._updateNotesAutocomplete(textarea);
    };
    textarea.onkeydown = (e) => {
      if (!this._notesAutocomplete.textarea || this._notesAutocomplete.textarea !== textarea)
        return;
      const popup = document.getElementById('tag-autocomplete');
      if (popup.classList.contains('hidden')) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        this._moveNotesAutocomplete(1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        this._moveNotesAutocomplete(-1);
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        this._applyNotesAutocompleteSelection();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this._hideNotesAutocomplete();
      }
    };
    textarea.onblur = () => {
      window.setTimeout(() => this._hideNotesAutocomplete(), 120);
      if (inlineSave) this._flushInlineNotesSave(contactId, textarea.value);
    };
  },

  _updateNotesAutocomplete(textarea) {
    const ctx = this._currentHashtagContext(textarea);
    if (!ctx) {
      this._hideNotesAutocomplete();
      return;
    }
    const allTags = this._allKnownNoteTags();
    const matches = allTags.filter((tag) => tag.startsWith(ctx.query.toLowerCase()));
    this._notesAutocomplete = {
      textarea,
      matches,
      selectedIndex: 0,
      start: ctx.start,
      end: ctx.end,
    };
    this._renderNotesAutocomplete(textarea, matches, ctx.query);
  },

  _currentHashtagContext(textarea) {
    const caret = textarea.selectionStart;
    const before = textarea.value.slice(0, caret);
    const match = before.match(/(^|\s)#([A-Za-z0-9_-]*)$/);
    if (!match) return null;
    const query = match[2] || '';
    const start = caret - query.length - 1;
    return { query, start, end: caret };
  },

  _allKnownNoteTags() {
    return Array.from(new Set(this.contacts.flatMap((contact) => contact.noteTags || []))).sort(
      (a, b) => a.localeCompare(b),
    );
  },

  _renderNotesAutocomplete(textarea, matches, query) {
    const popup = document.getElementById('tag-autocomplete');
    popup.innerHTML = '';
    if (matches.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'tag-autocomplete-empty';
      empty.textContent = query ? `No tags found for #${query}` : 'No tags found';
      popup.appendChild(empty);
    } else {
      matches.forEach((tag, idx) => {
        const item = document.createElement('div');
        item.className = `tag-autocomplete-item${idx === this._notesAutocomplete.selectedIndex ? ' active' : ''}`;
        item.textContent = `#${tag}`;
        item.addEventListener('mousedown', (e) => {
          e.preventDefault();
          this._notesAutocomplete.selectedIndex = idx;
          this._applyNotesAutocompleteSelection();
        });
        popup.appendChild(item);
      });
    }
    const rect = this._textareaCaretRect(textarea);
    popup.style.left = `${Math.min(rect.left, window.innerWidth - 300)}px`;
    popup.style.top = `${Math.min(rect.top + 22, window.innerHeight - 240)}px`;
    popup.classList.remove('hidden');
  },

  _moveNotesAutocomplete(delta) {
    const { matches } = this._notesAutocomplete;
    if (!matches.length) return;
    this._notesAutocomplete.selectedIndex =
      (this._notesAutocomplete.selectedIndex + delta + matches.length) % matches.length;
    this._renderNotesAutocomplete(this._notesAutocomplete.textarea, matches, '');
  },

  _applyNotesAutocompleteSelection() {
    const { textarea, matches, selectedIndex, start, end } = this._notesAutocomplete;
    if (!textarea || !matches.length) return;
    const chosen = `#${matches[selectedIndex]}`;
    const nextValue = textarea.value.slice(0, start) + chosen + textarea.value.slice(end);
    textarea.value = nextValue;
    const caret = start + chosen.length;
    textarea.focus();
    textarea.setSelectionRange(caret, caret);
    if (typeof textarea.oninput === 'function') textarea.oninput();
    this._hideNotesAutocomplete();
  },

  _hideNotesAutocomplete() {
    const popup = document.getElementById('tag-autocomplete');
    popup.classList.add('hidden');
    popup.innerHTML = '';
    this._notesAutocomplete = {
      textarea: null,
      matches: [],
      selectedIndex: 0,
      start: -1,
      end: -1,
    };
  },

  _textareaCaretRect(textarea) {
    const div = document.createElement('div');
    const style = window.getComputedStyle(textarea);
    for (const prop of [
      'boxSizing',
      'width',
      'height',
      'overflowX',
      'overflowY',
      'borderTopWidth',
      'borderRightWidth',
      'borderBottomWidth',
      'borderLeftWidth',
      'paddingTop',
      'paddingRight',
      'paddingBottom',
      'paddingLeft',
      'fontStyle',
      'fontVariant',
      'fontWeight',
      'fontStretch',
      'fontSize',
      'fontSizeAdjust',
      'lineHeight',
      'fontFamily',
      'textAlign',
      'textTransform',
      'textIndent',
      'textDecoration',
      'letterSpacing',
      'wordSpacing',
    ]) {
      div.style[prop] = style[prop];
    }
    div.style.position = 'absolute';
    div.style.visibility = 'hidden';
    div.style.whiteSpace = 'pre-wrap';
    div.style.wordWrap = 'break-word';
    div.textContent = textarea.value.slice(0, textarea.selectionStart);
    const span = document.createElement('span');
    span.textContent = textarea.value.slice(textarea.selectionStart) || '.';
    div.appendChild(span);
    document.body.appendChild(div);
    const spanRect = span.getBoundingClientRect();
    const taRect = textarea.getBoundingClientRect();
    const rect = {
      left: taRect.left + (spanRect.left - div.getBoundingClientRect().left) - textarea.scrollLeft,
      top: taRect.top + (spanRect.top - div.getBoundingClientRect().top) - textarea.scrollTop,
    };
    document.body.removeChild(div);
    return rect;
  },

  _scheduleInlineNotesSave(contactId, value) {
    if (this._inlineNotesSaveTimer) window.clearTimeout(this._inlineNotesSaveTimer);
    this._inlineNotesSaveTimer = window.setTimeout(() => {
      this._flushInlineNotesSave(contactId, value);
    }, 2000);
  },

  _flushInlineNotesSave(contactId, value) {
    if (this._inlineNotesSaveTimer) {
      window.clearTimeout(this._inlineNotesSaveTimer);
      this._inlineNotesSaveTimer = null;
    }
    const contact = this._contact(contactId);
    if (!contact) return;
    const nextNotes = this._splitNotes(value || '');
    if (this._notesText(contact.notes) === this._notesText(nextNotes)) return;
    contact.notes = nextNotes;
    contact.noteTags = this.parser._extractHashtags(contact.notes);
    contact.tags = this.parser._inferTags(contact);
    this._rewriteEditableFields(contact);
    this.builder = new RelationshipBuilder(this.contacts);
    this._rebuildGraph();
    void this._persistSession();
    this._showToast(`Notes updated for ${contact.fn || 'contact'}`, 'success');
  },
});

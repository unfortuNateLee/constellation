import { ContactRelationshipApp } from './app.js';
import { applyMixin } from './apply-mixin.js';
import { RelationshipBuilder } from './relationship-builder.js';
import { RelationshipTaxonomy } from './relationship-taxonomy.js';
import { makeSearchable } from './searchable-select.js';

/**
 * Relationship suggestion engine: infers reciprocal / missing / likely-cluster
 * relationships for the selected contact, renders the suggestion cards, and
 * applies an accepted suggestion. Extracted from app.js verbatim.
 */
class SuggestionsMixin {
  _findRelationshipSuggestions(node) {
    const suggestions = [];
    const seen = new Set();

    // ── Type 1: Mutual — A lists B but B doesn't list A back ──────────
    for (const rel of node.related || []) {
      const targetContact = this.builder.findContact(rel.name);
      if (!targetContact) continue; // virtual node, can't edit
      const targetNode = this._node(targetContact.id);
      if (!targetNode) continue;

      const alreadyListed = (targetNode.related || []).some((r) => {
        const rc = this.builder.findContact(r.name);
        if (rc && rc.id === node.id) return true;
        return r.name.toLowerCase().trim() === node.name.toLowerCase().trim();
      });

      if (!alreadyListed) {
        // The suggested back-link is node's own role on targetContact's card, so
        // gender it by node's gender (e.g. a Male node → "Father"/"Uncle").
        const reciprocal = this._reciprocalType(rel.type, node.gender);
        const key = `${targetContact.id}→${node.name}:${reciprocal}`;
        if (!seen.has(key) && !this._dismissedSuggestions.has(key)) {
          seen.add(key);
          const typeLabel = this.builder._friendlyType(rel.type);
          suggestions.push({
            key,
            kind: 'mutual',
            targetId: targetContact.id,
            targetName: targetContact.fn,
            relName: node.name,
            relType: reciprocal,
            reason: `${node.name} lists ${targetContact.fn} as ${this._possessivePronoun(node.gender)} ${typeLabel}, but ${this._firstName(targetContact.fn)} doesn't list ${this._firstName(node.name)} back.`,
          });
        }
      }
    }

    // ── Type 2: Outward — node's children should appear on spouse's card ─
    const spouseRelsOut = (node.related || []).filter((r) =>
      ['spouse', 'husband', 'wife', 'partner'].includes(r.type),
    );
    for (const spouseRel of spouseRelsOut) {
      const spouseContact = this.builder.findContact(spouseRel.name);
      if (!spouseContact) continue;
      const spouseNode = this._node(spouseContact.id);
      if (!spouseNode) continue;

      const childTypes = [
        'son',
        'daughter',
        'child',
        'stepson',
        'stepdaughter',
        'stepchild',
        'step-child',
      ];
      for (const child of (node.related || []).filter((r) => childTypes.includes(r.type))) {
        const childContact = this.builder.findContact(child.name);
        if (!childContact) continue;

        const spouseHasChild = (spouseNode.related || []).some((r) => {
          const rc = this.builder.findContact(r.name);
          return rc && rc.id === childContact.id;
        });

        if (!spouseHasChild) {
          const key = `${spouseContact.id}→${childContact.fn}:${child.type}`;
          if (!seen.has(key) && !this._dismissedSuggestions.has(key)) {
            seen.add(key);
            const bond = spouseRel.type === 'spouse' ? 'married' : 'partners';
            suggestions.push({
              key,
              kind: 'shared-child',
              targetId: spouseContact.id,
              targetName: spouseContact.fn,
              relName: child.name,
              relType: child.type,
              reason: `${node.name} and ${spouseContact.fn} are ${bond}; ${child.name} may be ${spouseContact.fn}'s ${child.type} too.`,
            });
          }
        }
      }
    }

    // ── Type 3: Inward transitive — walk two-hop family chains ───────────
    // Rules: if node has [pivotTypes] rel with P, and P has [bridgeTypes] rel
    // with T (T ≠ node), then suggest adding [inferredType] rel (T) to node's card.
    // inferredType = null means "use the same type as the bridge rel".
    const INWARD_TRANSITIONS = [
      // Via spouse/partner → shared children
      {
        pivotTypes: ['spouse', 'husband', 'wife', 'partner'],
        bridgeTypes: [
          'son',
          'daughter',
          'child',
          'stepson',
          'stepdaughter',
          'stepchild',
          'step-child',
        ],
        inferredType: null,
      },
      // Via parent → siblings (parent's other children); gender-specific when known
      {
        pivotTypes: [
          'parent',
          'mother',
          'father',
          'stepmother',
          'stepfather',
          'stepparent',
          'step-parent',
        ],
        bridgeTypes: [
          'son',
          'daughter',
          'child',
          'stepson',
          'stepdaughter',
          'stepchild',
          'step-child',
        ],
        typeMapper: (bt) =>
          bt === 'son' || bt === 'stepson'
            ? 'brother'
            : bt === 'daughter' || bt === 'stepdaughter'
              ? 'sister'
              : 'sibling',
      },
      // Via parent → grandparents (parent's parents)
      {
        pivotTypes: ['parent', 'mother', 'father'],
        bridgeTypes: ['parent', 'mother', 'father', 'grandmother', 'grandfather', 'grandparent'],
        typeMapper: (bt) =>
          bt === 'mother' || bt === 'grandmother'
            ? 'grandmother'
            : bt === 'father' || bt === 'grandfather'
              ? 'grandfather'
              : 'grandparent',
      },
      // Via parent → uncle/aunt (parent's siblings); gender-specific
      {
        pivotTypes: ['parent', 'mother', 'father'],
        bridgeTypes: ['sibling', 'brother', 'sister'],
        typeMapper: (bt) => (bt === 'brother' ? 'uncle' : bt === 'sister' ? 'aunt' : 'uncle'),
      },
      // Via child → grandchildren (child's children)
      {
        pivotTypes: ['son', 'daughter', 'child'],
        bridgeTypes: ['son', 'daughter', 'child'],
        typeMapper: (bt) =>
          bt === 'son' ? 'grandson' : bt === 'daughter' ? 'granddaughter' : 'grandchild',
      },
      // Via sibling → nephew/niece (sibling's children); gender-specific
      {
        pivotTypes: ['sibling', 'brother', 'sister'],
        bridgeTypes: ['son', 'daughter', 'child'],
        typeMapper: (bt) => (bt === 'son' ? 'nephew' : bt === 'daughter' ? 'niece' : 'nephew'),
      },
      // Via sibling → parent (sibling's parents = node's parents)
      {
        pivotTypes: ['sibling', 'brother', 'sister'],
        bridgeTypes: ['parent', 'mother', 'father', 'grandmother', 'grandfather'],
        typeMapper: (bt) =>
          bt === 'mother' || bt === 'grandmother'
            ? 'mother'
            : bt === 'father' || bt === 'grandfather'
              ? 'father'
              : 'parent',
      },
      // Via uncle/aunt → cousins (uncle/aunt's children)
      {
        pivotTypes: ['uncle', 'aunt', 'uncle/aunt'],
        bridgeTypes: ['son', 'daughter', 'child'],
        inferredType: 'cousin',
      },
      // Via grandparent → uncle/aunt (grandparent's other children); gender-specific
      {
        pivotTypes: ['grandmother', 'grandfather', 'grandparent'],
        bridgeTypes: ['son', 'daughter', 'child'],
        typeMapper: (bt) => (bt === 'son' ? 'uncle' : bt === 'daughter' ? 'aunt' : 'uncle'),
      },
      // Via nephew/niece → sibling (nephew/niece's parent = node's sibling); gender-specific
      {
        pivotTypes: ['nephew', 'niece', 'nephew/niece'],
        bridgeTypes: ['parent', 'mother', 'father'],
        typeMapper: (bt) => (bt === 'mother' ? 'sister' : bt === 'father' ? 'brother' : 'sibling'),
      },
      // Via cousin → uncle/aunt (cousin's parent = node's uncle/aunt); gender-specific
      {
        pivotTypes: ['cousin'],
        bridgeTypes: ['parent', 'mother', 'father'],
        typeMapper: (bt) => (bt === 'mother' ? 'aunt' : bt === 'father' ? 'uncle' : 'uncle'),
      },
      // Via grandchild → child (grandchild's parent = node's child); gender-specific
      {
        pivotTypes: ['grandson', 'granddaughter', 'grandchild'],
        bridgeTypes: ['parent', 'mother', 'father'],
        typeMapper: (bt) => (bt === 'mother' ? 'daughter' : bt === 'father' ? 'son' : 'child'),
      },
      // Via nephew/niece → nephew/niece's siblings are also my nephew/niece; gender-specific
      {
        pivotTypes: ['nephew', 'niece', 'nephew/niece'],
        bridgeTypes: ['sibling', 'brother', 'sister'],
        typeMapper: (bt) => (bt === 'brother' ? 'nephew' : bt === 'sister' ? 'niece' : 'nephew'),
      },
      // Via grandchild → grandchild's siblings are also my grandchild; gender-specific
      {
        pivotTypes: ['grandson', 'granddaughter', 'grandchild'],
        bridgeTypes: ['sibling', 'brother', 'sister'],
        typeMapper: (bt) =>
          bt === 'brother' ? 'grandson' : bt === 'sister' ? 'granddaughter' : 'grandchild',
      },
      // Via cousin → cousin's siblings are also my cousin
      {
        pivotTypes: ['cousin'],
        bridgeTypes: ['sibling', 'brother', 'sister'],
        inferredType: 'cousin',
      },
    ];

    for (const rule of INWARD_TRANSITIONS) {
      const pivotRels = (node.related || []).filter((r) => rule.pivotTypes.includes(r.type));
      for (const pivotRel of pivotRels) {
        const pivotContact = this.builder.findContact(pivotRel.name);
        if (!pivotContact) continue;
        const pivotNode = this._node(pivotContact.id);
        if (!pivotNode) continue;

        const bridgeRels = (pivotNode.related || []).filter((r) =>
          rule.bridgeTypes.includes(r.type),
        );
        for (const bridgeRel of bridgeRels) {
          // The suggested third party may be a real OR a virtual contact.
          const thirdContact = this._resolveSuggestParty(bridgeRel.name);
          if (!thirdContact) continue;
          if (thirdContact.id === node.id) continue; // skip self

          const inferredType = rule.typeMapper
            ? rule.typeMapper(bridgeRel.type)
            : rule.inferredType || bridgeRel.type;

          // Skip if node already lists this person in any role
          const alreadyHas = (node.related || []).some((r) => {
            const rc = this.builder.findContact(r.name);
            if (!rc) return false;
            if (rc.id === thirdContact.id) return true;
            // Also match by name string directly in case findContact misses due to format difference
            return r.name.toLowerCase().trim() === thirdContact.fn.toLowerCase().trim();
          });
          if (alreadyHas) continue;

          const key = `${node.id}→${thirdContact.fn}:${inferredType}`;
          if (!seen.has(key) && !this._dismissedSuggestions.has(key)) {
            seen.add(key);
            const pivotLabel = this.builder._friendlyType(pivotRel.type).toLowerCase();
            const bridgeLabel = this.builder._friendlyType(bridgeRel.type).toLowerCase();
            const inferredLabel = this.builder._friendlyType(inferredType).toLowerCase();
            suggestions.push({
              key,
              kind: 'transitive',
              targetId: node.id,
              targetName: node.name,
              relName: thirdContact.fn,
              relType: inferredType,
              reason: `${this._firstName(node.name)}'s ${pivotLabel} ${pivotContact.fn} lists ${thirdContact.fn} as ${this._possessivePronoun(pivotContact.gender)} ${bridgeLabel}, making ${this._firstName(thirdContact.fn)} ${this._firstName(node.name)}'s likely ${inferredLabel}.`,
            });
          }
        }
      }
    }

    // ── Pre-build inbound reference index (shared by Types 4 and 5) ────────
    // Find every contact that references this node, plus which rel entry points to it.
    // This avoids O(n) re-scans in both Type 4 and Type 5.
    const childRelTypes = new Set([
      'son',
      'daughter',
      'child',
      'stepson',
      'stepdaughter',
      'stepchild',
      'step-child',
    ]);
    const inboundRefs = []; // { contact, rel } for all rels pointing at node
    for (const otherContact of this.contacts) {
      if (otherContact.id === node.id) continue;
      for (const rel of otherContact.related || []) {
        let points = rel.name.toLowerCase().trim() === node.name.toLowerCase().trim();
        if (!points) {
          const rc = this.builder.findContact(rel.name);
          points = !!(rc && rc.id === node.id);
        }
        if (points) inboundRefs.push({ contact: otherContact, rel });
      }
    }

    // ── Type 4: Reverse-parent → siblings ────────────────────────────────
    // Find every contact that lists THIS node as their child, then suggest
    // that contact's other children as this node's siblings.
    // (Works even when the child hasn't listed their parent back.)
    const parentContacts = inboundRefs
      .filter(({ rel }) => childRelTypes.has(rel.type))
      .map(({ contact }) => contact);
    // Deduplicate (a parent might be found via multiple matching rel entries)
    const uniqueParents = [...new Map(parentContacts.map((c) => [c.id, c])).values()];

    for (const otherContact of uniqueParents) {
      // otherContact is a parent — check their other children
      for (const childRel of (otherContact.related || []).filter((r) =>
        childRelTypes.has(r.type),
      )) {
        // The suggested sibling may be a real OR a virtual contact.
        const sibContact = this._resolveSuggestParty(childRel.name);
        if (!sibContact) continue;
        if (sibContact.id === node.id) continue; // skip self

        const alreadyHas = (node.related || []).some((r) => {
          const rc = this.builder.findContact(r.name);
          if (rc && rc.id === sibContact.id) return true;
          return r.name.toLowerCase().trim() === sibContact.fn.toLowerCase().trim();
        });
        if (alreadyHas) continue;

        const sibType =
          childRel.type === 'son' ? 'brother' : childRel.type === 'daughter' ? 'sister' : 'sibling';
        const key = `${node.id}→${sibContact.fn}:${sibType}`;
        if (!seen.has(key) && !this._dismissedSuggestions.has(key)) {
          seen.add(key);
          suggestions.push({
            key,
            kind: 'transitive',
            targetId: node.id,
            targetName: node.name,
            relName: sibContact.fn,
            relType: sibType,
            reason: `${otherContact.fn} lists both ${this._firstName(node.name)} and ${this._firstName(sibContact.fn)} as ${this._possessivePronoun(otherContact.gender)} ${childRel.type}.`,
          });
        }
      }
    }

    // ── Type 5: Inbound reciprocal ────────────────────────────────────────
    // Use the pre-built inbound index to find anyone who lists node as a
    // relative but node doesn't list them back.
    for (const { contact: otherContact, rel } of inboundRefs) {
      // Does node already list otherContact back in any role?
      const alreadyHas = (node.related || []).some((r) => {
        const rc = this.builder.findContact(r.name);
        if (rc && rc.id === otherContact.id) return true;
        return r.name.toLowerCase().trim() === otherContact.fn.toLowerCase().trim();
      });
      if (alreadyHas) continue;

      // The suggested type describes otherContact's role on node's card → gender
      // it by otherContact's gender.
      const recipType = this._reciprocalType(rel.type, otherContact.gender);
      const key = `${node.id}→${otherContact.fn}:${recipType}:inbound`;
      if (!seen.has(key) && !this._dismissedSuggestions.has(key)) {
        seen.add(key);
        suggestions.push({
          key,
          kind: 'mutual',
          targetId: node.id,
          targetName: node.name,
          relName: otherContact.fn,
          relType: recipType,
          reason: `${otherContact.fn} lists ${this._firstName(node.name)} as ${this._possessivePronoun(otherContact.gender)} ${this.builder._friendlyType(rel.type).toLowerCase()}, but ${this._firstName(node.name)} doesn't list ${this._firstName(otherContact.fn)} back.`,
        });
      }
    }

    // ── Type 6: Likely-connections cluster peers ────────────────────────
    if (
      this._graphMode === 'connections' ||
      this._graphMode === 'likely-connections' ||
      this._graphMode === 'likely-family'
    ) {
      const clustered = new Map();
      for (const e of this.graphData.edges || []) {
        if (!['likely-surname', 'likely-tag', 'likely-family'].includes(e.edgeKind)) continue;
        const s = typeof e.source === 'object' ? e.source.id : e.source;
        const t = typeof e.target === 'object' ? e.target.id : e.target;
        const sourceNode = this._node(s);
        const targetNode = this._node(t);

        if (sourceNode?.isGroupNode && t === node.id) {
          for (const memberId of sourceNode.memberIds || []) {
            if (memberId === node.id) continue;
            if (!clustered.has(memberId)) clustered.set(memberId, []);
            clustered.get(memberId).push(sourceNode);
          }
        } else if (targetNode?.isGroupNode && s === node.id) {
          for (const memberId of targetNode.memberIds || []) {
            if (memberId === node.id) continue;
            if (!clustered.has(memberId)) clustered.set(memberId, []);
            clustered.get(memberId).push(targetNode);
          }
        }
      }

      for (const [clusteredId, reasons] of clustered.entries()) {
        const otherNode = this._node(clusteredId);
        if (otherNode?.isGroupNode) continue;
        if (!otherNode) continue;

        const alreadyHas = (node.related || []).some((r) => {
          const rc = this.builder.findContact(r.name);
          if (rc && rc.id === clusteredId) return true;
          return r.name.toLowerCase().trim() === otherNode.name.toLowerCase().trim();
        });
        if (alreadyHas) continue;

        const reasonText = reasons.map((group) => {
          if (group.groupKind === 'likely-tag') return `shared hashtag ${group.name}`;
          if (group.groupKind === 'likely-surname')
            return `shared surname "${group.name.replace(/ family$/i, '')}"`;
          return group.name;
        });
        const uniqueReasons = Array.from(new Set(reasonText));
        const key = `${node.id}→${otherNode.name}:relative:likely-connections:${uniqueReasons.join('|')}`;
        if (!seen.has(key) && !this._dismissedSuggestions.has(key)) {
          seen.add(key);
          suggestions.push({
            key,
            kind: 'likely-connections',
            targetId: node.id,
            targetName: node.name,
            relName: otherNode.name,
            relType: 'relative',
            reason: `${otherNode.name} is grouped with ${node.name} in Connections because of ${uniqueReasons.join(' and ')}.`,
          });
        }
      }
    }

    return suggestions;
  }

  _renderSuggestions(node, parentBody) {
    const suggestions = this._findRelationshipSuggestions(node);
    if (suggestions.length === 0) return;

    // Suggested Additions is its own top-level collapsible section, a sibling
    // of the Relationships master (parentBody is detail-relationships).
    const sub = this._makeCollapsible('Suggested Additions', {
      collapsed: this._suggSectionCollapsed,
      onToggle: (c) => {
        this._suggSectionCollapsed = c;
      },
      badgeText: String(suggestions.length),
      badgeClass: 'suggestions-badge',
    });
    parentBody.appendChild(sub.section);
    const el = sub.body;

    for (const s of suggestions) {
      const item = document.createElement('div');
      item.className = 'suggestion-item';

      item.innerHTML = `
        <div class="suggestion-body">
          <div class="suggestion-action">
            Add <strong>${this._escapeHtml(s.relName)}</strong>
            as <select class="suggestion-type-select">${this._relTypeOptionsHtml(s.relType)}</select>
            to <strong>${this._escapeHtml(s.targetName)}</strong>'s card
          </div>
          <div class="suggestion-reason">${this._escapeHtml(s.reason)}</div>
        </div>
        <div class="suggestion-btns">
          <button class="btn btn-primary btn-xs s-add">Add</button>
          <button class="btn btn-ghost btn-xs s-dismiss">✕</button>
        </div>
      `;

      const typeSelect = item.querySelector('.suggestion-type-select');
      const isCustomSelected = !this._isKnownRelationshipType(s.relType);

      // Freeform input for suggestions (shown when "Custom…" is chosen)
      const suggCustomInput = document.createElement('input');
      suggCustomInput.type = 'text';
      suggCustomInput.className = 'rel-custom-input';
      suggCustomInput.placeholder = 'e.g. mentor…';
      suggCustomInput.style.display = isCustomSelected ? 'inline-block' : 'none';
      if (isCustomSelected) suggCustomInput.value = s.relType || '';
      typeSelect.insertAdjacentElement('afterend', suggCustomInput);

      typeSelect.addEventListener('change', () => {
        const isCustom = typeSelect.value === '__custom__';
        suggCustomInput.style.display = isCustom ? 'inline-block' : 'none';
        if (isCustom) {
          suggCustomInput.value = '';
          suggCustomInput.focus();
        }
      });
      makeSearchable(typeSelect, { placeholder: 'Search types…' });

      item.querySelector('.s-add').addEventListener('click', () => {
        let relType =
          typeSelect.value === '__custom__'
            ? suggCustomInput.value.trim().toLowerCase()
            : typeSelect.value || s.relType;
        if (!relType || relType === '__custom__') return;
        s.relType = relType;
        this._applyRelationshipSuggestion(s, node);
      });
      item.querySelector('.s-dismiss').addEventListener('click', () => {
        this._dismissedSuggestions.add(s.key);
        item.remove();
        const remaining = el.querySelectorAll('.suggestion-item').length;
        if (remaining === 0) sub.section.remove();
        else sub.setBadge(String(remaining));
      });

      el.appendChild(item);
    }
  }

  _applyRelationshipSuggestion(suggestion, currentNode) {
    const contact = this._contact(suggestion.targetId);
    if (!contact || !contact.rawVCard) {
      this._showToast(`Cannot modify ${suggestion.targetName}: no raw VCard data`, 'error');
      return;
    }

    // Find highest item number already in use
    const usedItems = [...contact.rawVCard.matchAll(/^item(\d+)\./gim)].map((m) => parseInt(m[1]));
    const nextItem = usedItems.length > 0 ? Math.max(...usedItems) + 1 : 1;

    const label = this._typeToVCardLabel(suggestion.relType);
    const newLines = this._joinVCardLines([
      `item${nextItem}.X-ABRELATEDNAMES:${this._vCardEscape(suggestion.relName)}`,
      `item${nextItem}.X-ABLabel:${label}`,
    ]);
    contact.rawVCard = this._insertBeforeEndVCard(contact.rawVCard, newLines);

    // Update parsed data
    contact.related.push({ name: suggestion.relName, type: suggestion.relType, rawType: label });

    // Mark dismissed so it won't reappear
    this._dismissedSuggestions.add(suggestion.key);

    // Rebuild graph
    this.builder = new RelationshipBuilder(this.contacts);
    this._rebuildGraph();
    void this._persistSession();

    // Re-render the detail panel for the current node
    const refreshedNode = this._node(currentNode.id);
    if (refreshedNode) this._onNodeSelect(refreshedNode);

    this._showToast(
      `Added ${this.builder._friendlyType(suggestion.relType)} to ${suggestion.targetName}'s card`,
      'success',
    );
  }

  // Reciprocal type, gendered by the gender of whoever will hold that reciprocal
  // role (pass their 'M'/'F' gender; '' → neutral/canonical).
  _reciprocalType(type, gender = '') {
    return RelationshipTaxonomy.genderedReciprocal(type, gender);
  }

  // First token of a name — suggestion text reads better with first names
  // ("Avery" not "Avery Judd") and must never say "you" for a non-self card.
  _firstName(name) {
    const s = String(name || '').trim();
    return s.split(/\s+/)[0] || s;
  }

  // Possessive pronoun for suggestion text, by gender ('M'→his, 'F'→her, else they/their).
  _possessivePronoun(gender) {
    return gender === 'M' ? 'his' : gender === 'F' ? 'her' : 'their';
  }

  // Resolve a related-party name to a uniform { id, fn, gender, isVirtual }: a real
  // contact if one matches, otherwise an existing virtual node (a placeholder for a
  // person referenced in a relationship but not imported). Lets suggestions point at
  // virtual contacts the same way they point at real ones.
  _resolveSuggestParty(name) {
    const real = this.builder.findContact(name);
    if (real) return { id: real.id, fn: real.fn, gender: real.gender || '', isVirtual: false };
    const want = String(name || '')
      .trim()
      .toLowerCase();
    if (!want) return null;
    const vn = (this.graphData?.nodes || []).find(
      (n) =>
        n.isVirtual &&
        !n.isGroupNode &&
        String(n.name || '')
          .trim()
          .toLowerCase() === want,
    );
    return vn ? { id: vn.id, fn: vn.name, gender: vn.gender || '', isVirtual: true } : null;
  }

  /**
   * Returns true when `candidate` is less specific than `existing`.
   * Prevents overwriting a precise reciprocal (e.g. "son") with a generic one
   * (e.g. "child") when the user makes the *other* side more specific
   * (e.g. "parent" → "mother" computes reciprocal "child", but "son" already exists).
   */
  _isReciprocalDowngrade(candidate, existing) {
    return RelationshipTaxonomy.isReciprocalDowngrade(candidate, existing);
  }

  _typeToVCardLabel(type) {
    return RelationshipTaxonomy.vcardLabel(type);
  }

  _isKnownRelationshipType(type) {
    return RelationshipTaxonomy.isKnown(type);
  }

  _getOrgForNode(node) {
    const contact = this._contact(node.id);
    return contact?.org || node.org || '';
  }
}

applyMixin(ContactRelationshipApp.prototype, SuggestionsMixin);

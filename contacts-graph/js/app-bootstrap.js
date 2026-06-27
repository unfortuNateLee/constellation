import { ContactRelationshipApp } from './app.js';
import { RelationshipBuilder } from './relationship-builder.js';
import './app-notes.js'; // side effect: mixes notes/autocomplete methods into the prototype

/**
 * Browser startup and modal wiring. Entry module — index.html loads only this.
 * Kept separate from ContactRelationshipApp so app.js remains focused on controller behavior.
 */
document.addEventListener('DOMContentLoaded', () => {
  window.app = new ContactRelationshipApp();
  void window.app._updateSessionButtons();

  // "Choose file" button in the drop zone opens the hidden file input.
  document.getElementById('btn-import-drop').addEventListener('click', () => {
    document.getElementById('file-input').click();
  });

  // Close modal
  document.getElementById('modal-cancel').addEventListener('click', () => {
    document.getElementById('add-rel-modal').classList.add('hidden');
  });

  document.getElementById('add-rel-modal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('add-rel-modal')) {
      document.getElementById('add-rel-modal').classList.add('hidden');
    }
  });

  document.getElementById('bulk-cancel').addEventListener('click', () => {
    window.app._closeBulkNormalizeModal();
  });

  document.getElementById('bulk-normalize-modal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('bulk-normalize-modal')) {
      window.app._closeBulkNormalizeModal();
    }
  });

  document.getElementById('bulk-action-type').addEventListener('change', (e) => {
    if (!window.app._bulkRuleState) return;
    window.app._bulkRuleState.action.type = e.target.value;
    window.app._syncBulkActionControls();
    window.app._updateBulkNormalizePreview();
  });

  document.getElementById('bulk-action-field').addEventListener('change', (e) => {
    if (!window.app._bulkRuleState) return;
    window.app._bulkRuleState.action.field = e.target.value;
    window.app._syncBulkActionControls();
    window.app._updateBulkNormalizePreview();
  });

  document.getElementById('bulk-action-value').addEventListener('input', (e) => {
    if (!window.app._bulkRuleState) return;
    window.app._bulkRuleState.action.value = e.target.value;
    window.app._updateBulkNormalizePreview();
  });

  document.getElementById('bulk-apply').addEventListener('click', () => {
    window.app._applyBulkNormalize();
  });

  document.getElementById('modal-save').addEventListener('click', () => {
    const fromId = window.app._selectedNodeId;
    const targetMode = document.getElementById('modal-target-mode').value;
    const toId = document.getElementById('modal-target-select').value;
    const manualName = document.getElementById('modal-target-name').value.trim();
    const createMode = document.getElementById('modal-create-mode').value;
    const relType = document.getElementById('modal-rel-type').value;
    const custom = document.getElementById('modal-rel-custom').value.trim();

    if (!fromId || !relType || (targetMode === 'existing' ? !toId : !manualName)) {
      window.app._showToast('Please fill in all fields', 'error');
      return;
    }

    const finalType = relType === 'custom' ? custom : relType;
    if (!finalType) {
      window.app._showToast('Please enter a relationship type', 'error');
      return;
    }

    const fromContact = window.app._contact(fromId);
    if (!fromContact) return;

    let relName = '';
    let createdRealContact = false;
    if (targetMode === 'existing') {
      const toNode = window.app._node(toId);
      if (!toNode) return;
      relName = toNode.name;
    } else {
      relName = manualName;
      if (createMode === 'real') {
        const existing = window.app._contactsByFn.get(manualName.toLowerCase().trim());
        if (existing) {
          relName = existing.fn;
        } else {
          const contact = window.app._makeMinimalContact(manualName);
          window.app.contacts.push(contact);
          relName = contact.fn;
          createdRealContact = true;
        }
      }
    }

    if (fromContact) {
      const vcardLabel = window.app._typeToVCardLabel(finalType);
      if (fromContact.rawVCard) {
        const usedItems = [...fromContact.rawVCard.matchAll(/^item(\d+)\./gim)].map((m) =>
          parseInt(m[1]),
        );
        const nextItem = usedItems.length > 0 ? Math.max(...usedItems) + 1 : 1;
        const newLines = window.app._joinVCardLines([
          `item${nextItem}.X-ABRELATEDNAMES:${window.app._vCardEscape(relName)}`,
          `item${nextItem}.X-ABLabel:${vcardLabel}`,
        ]);
        fromContact.rawVCard = window.app._insertBeforeEndVCard(fromContact.rawVCard, newLines);
      }
      fromContact.related.push({ name: relName, type: finalType, rawType: vcardLabel });
      window.app.builder = new RelationshipBuilder(window.app.contacts);
      window.app._rebuildGraph();
      void window.app._persistSession();
      const toastMsg = createdRealContact
        ? `Added ${window.app.builder._friendlyType(finalType)} to ${relName} and created a real contact`
        : `Added ${window.app.builder._friendlyType(finalType)} to ${relName}`;
      window.app._showToast(toastMsg, 'success');

      // Re-select the node
      const updatedNode = window.app._node(fromId);
      if (updatedNode) {
        setTimeout(() => {
          window.app.graph.highlightContact(fromId);
          window.app._onNodeSelect(updatedNode);
        }, 100);
      }
    }

    document.getElementById('add-rel-modal').classList.add('hidden');
  });

  // Toggle custom rel type field
  document.getElementById('modal-rel-type').addEventListener('change', (e) => {
    document
      .getElementById('modal-custom-row')
      .classList.toggle('hidden', e.target.value !== 'custom');
  });

  document.getElementById('modal-target-mode').addEventListener('change', (e) => {
    const manual = e.target.value === 'manual';
    document.getElementById('modal-target-select-row').classList.toggle('hidden', manual);
    document.getElementById('modal-manual-name-row').classList.toggle('hidden', !manual);
    document.getElementById('modal-create-mode-row').classList.toggle('hidden', !manual);
  });
});

import { ContactRelationshipApp } from './app-controller.js';
import { RelationshipTaxonomy } from './relationship-taxonomy.js';

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

  // First-screen onboarding: restore the last session straight from the drop zone
  // (only shown when a saved session exists; see _updateSessionButtons).
  document.getElementById('btn-restore-session-drop')?.addEventListener('click', () => {
    void window.app._restorePersistedSession();
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

  document.getElementById('bulk-action-rel').addEventListener('change', (e) => {
    if (!window.app._bulkRuleState) return;
    window.app._bulkRuleState.action.value = e.target.value;
    window.app._updateBulkNormalizePreview();
  });

  document.getElementById('bulk-where-op').addEventListener('change', (e) => {
    if (!window.app._bulkRuleState) return;
    window.app._bulkRuleState.action.where.op = e.target.value;
    window.app._updateBulkNormalizePreview();
  });

  document.getElementById('bulk-where-add').addEventListener('click', () => {
    if (!window.app._bulkRuleState) return;
    const def = window.app._bulkFieldDef(window.app._bulkRuleState.action.field);
    if (!def.entity) return;
    window.app._bulkRuleState.action.where.conditions.push(
      window.app._newBulkWhereCondition(def.entity),
    );
    window.app._syncBulkActionControls();
    window.app._updateBulkNormalizePreview();
  });

  for (const radio of document.querySelectorAll('input[name="bulk-apply-to"]')) {
    radio.addEventListener('change', (e) => {
      if (!window.app._bulkRuleState || !e.target.checked) return;
      window.app._bulkRuleState.action.applyTo = e.target.value;
      window.app._syncBulkActionControls();
      window.app._updateBulkNormalizePreview();
    });
  }

  document.getElementById('bulk-apply').addEventListener('click', () => {
    window.app._applyBulkNormalize();
  });

  document.getElementById('modal-save').addEventListener('click', () => {
    window.app._saveAddRelationshipModal();
  });

  // Toggle custom rel type field
  document.getElementById('modal-rel-type').addEventListener('change', (e) => {
    document
      .getElementById('modal-custom-row')
      .classList.toggle('hidden', e.target.value !== RelationshipTaxonomy.CUSTOM_OPTION_VALUE);
  });

  document.getElementById('modal-target-mode').addEventListener('change', (e) => {
    const manual = e.target.value === 'manual';
    document.getElementById('modal-target-select-row').classList.toggle('hidden', manual);
    document.getElementById('modal-manual-name-row').classList.toggle('hidden', !manual);
    document.getElementById('modal-create-mode-row').classList.toggle('hidden', !manual);
  });
});

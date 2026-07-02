#!/usr/bin/env node
/**
 * Dump the relationship taxonomy (js/relationship-taxonomy.js — the single
 * source of truth) as Markdown, for embedding in docs/DESIGN_SPEC.md.
 *
 *   node scripts/gen-taxonomy-doc.js > /tmp/taxonomy.md
 *
 * Regenerate and re-paste whenever the taxonomy changes so the spec can't
 * drift from the code.
 */
import { RelationshipTaxonomy } from '../js/relationship-taxonomy.js';

const T = RelationshipTaxonomy;
const lines = [];

lines.push('#### Relationship types');
lines.push('');
lines.push(
  '| Type (canonical key) | Display label | X-ABLabel | Category | Reciprocal | Generic parent |',
);
lines.push('| --- | --- | --- | --- | --- | --- |');
for (const [key, entry] of Object.entries(T.TYPES)) {
  const vcard = `\`_$!<${entry.vcardLabel || entry.label}>!$_\``;
  lines.push(
    `| \`${key}\` | ${entry.label} | ${vcard} | ${entry.category} | ${
      entry.reciprocal ? `\`${entry.reciprocal}\`` : '—'
    } | ${entry.generic ? `\`${entry.generic}\`` : '—'} |`,
  );
}

lines.push('');
lines.push('#### Aliases (normalized on import)');
lines.push('');
lines.push('| Alias | Canonical type |');
lines.push('| --- | --- |');
for (const [alias, canonical] of Object.entries(T.ALIASES)) {
  lines.push(`| \`${alias}\` | \`${canonical}\` |`);
}

lines.push('');
lines.push('#### Gender groups (concept → gendered variants)');
lines.push('');
lines.push('| Concept | Male | Female | Neutral |');
lines.push('| --- | --- | --- | --- |');
for (const [concept, group] of Object.entries(T.GENDER_GROUPS)) {
  lines.push(
    `| \`${concept}\` | ${group.M ? `\`${group.M}\`` : '—'} | ${
      group.F ? `\`${group.F}\`` : '—'
    } | ${group.neutral ? `\`${group.neutral}\`` : '—'} |`,
  );
}

lines.push('');
lines.push('#### Valid reciprocal pairs');
lines.push('');
lines.push(
  'An edge is labeled with both endpoint roles only when the pair appears here (guards against data-entry errors):',
);
lines.push('');
for (const [a, b] of T.VALID_RECIPROCAL_PAIRS) {
  lines.push(`- \`${a}\` ↔ \`${b}\``);
}

console.log(lines.join('\n'));

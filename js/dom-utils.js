/**
 * Shared DOM/HTML helpers.
 *
 * escapeHtml is the single escaping routine for interpolating user data into
 * innerHTML template literals — it covers attribute contexts too (quotes),
 * so it is safe for both text and quoted-attribute positions.
 */
export function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

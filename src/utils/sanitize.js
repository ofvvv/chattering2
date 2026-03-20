'use strict';

/* ═══════════════════════════════════════════════════════════════════════════
   Sanitize Utility
   ═══════════════════════════════════════════════════════════════════════════
   HTML escaping and text sanitization functions.
   Used by chat.js and dock.js to prevent XSS.
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Escape HTML special characters
 * @param {string} text - Text to escape
 * @returns {string} Escaped text
 */
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Escape HTML attribute values
 * @param {string} text - Text to escape
 * @returns {string} Escaped text
 */
function escapeAttr(text) {
  if (!text) return '';
  return text.replace(/"/g, '"');
}

module.exports = { escapeHtml, escapeAttr };

'use strict';

/* ═══════════════════════════════════════════════════════════════════════════
   Utilities Index
   ═══════════════════════════════════════════════════════════════════════════
   Central export point for all utility modules.
   ═══════════════════════════════════════════════════════════════════════════ */

// Main process utilities
const { broadcast } = require('./broadcast');
const { formatTime, formatRelative } = require('./time');

// Note: sanitize and dom are for renderer processes only
// They must be imported directly where needed

module.exports = {
  // Main process
  broadcast,
  formatTime,
  formatRelative
};

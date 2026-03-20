'use strict';

/* ═══════════════════════════════════════════════════════════════════════════
   Time Utility
   ═══════════════════════════════════════════════════════════════════════════
   Time formatting functions for timestamps across the app.
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Format time as HH:MM (24-hour format)
 * @param {Date} date - Date object (defaults to now)
 * @returns {string} Formatted time string
 */
function formatTime(date = new Date()) {
  return date.toLocaleTimeString('es-MX', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
}

/**
 * Format date as relative time (e.g., "2 min ago")
 * @param {Date} date - Date object
 * @returns {string} Relative time string
 */
function formatRelative(date) {
  const now = Date.now();
  const diff = now - date.getTime();
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d`;
  if (hours > 0) return `${hours}h`;
  if (minutes > 0) return `${minutes}m`;
  return 'ahora';
}

module.exports = { formatTime, formatRelative };

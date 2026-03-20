'use strict';

/* ═══════════════════════════════════════════════════════════════════════════
   DOM Utility
   ═══════════════════════════════════════════════════════════════════════════
   Helper functions for DOM manipulation.
   Used by chat.js, dock.js, and other renderer scripts.
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Create an element with attributes and children
 * @param {string} tag - HTML tag name
 * @param {Object} attrs - Attributes and properties
 * @param {Array} children - Child nodes or strings
 * @returns {HTMLElement}
 */
function el(tag, attrs = {}, children = []) {
  const e = document.createElement(tag);

  Object.entries(attrs).forEach(([key, value]) => {
    if (key === 'className') {
      e.className = value;
    } else if (key === 'text') {
      e.textContent = value;
    } else if (key === 'html') {
      e.innerHTML = value;
    } else if (key.startsWith('on')) {
      e.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'style' && typeof value === 'object') {
      Object.assign(e.style, value);
    } else if (key.startsWith('data-')) {
      e.setAttribute(key, value);
    } else {
      e.setAttribute(key, value);
    }
  });

  children.forEach(child => {
    if (typeof child === 'string') {
      e.appendChild(document.createTextNode(child));
    } else if (child instanceof Node) {
      e.appendChild(child);
    }
  });

  return e;
}

/**
 * Shorthand for document.querySelector
 * @param {string} sel - CSS selector
 * @param {Element} ctx - Context element
 * @returns {Element|null}
 */
function $(sel, ctx = document) {
  return ctx.querySelector(sel);
}

/**
 * Shorthand for document.querySelectorAll
 * @param {string} sel - CSS selector
 * @param {Element} ctx - Context element
 * @returns {Array}
 */
function $$(sel, ctx = document) {
  return [...ctx.querySelectorAll(sel)];
}

/**
 * Remove all children from an element
 * @param {Element} el - Element to clear
 */
function clear(el) {
  while (el.firstChild) {
    el.removeChild(el.firstChild);
  }
}

module.exports = { el, $, $$, clear };

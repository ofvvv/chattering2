#!/usr/bin/env node
/**
 * scripts/convert-icons.js
 * 
 * Converts assets/chattering.svg → assets/icons/chattering.{ico,icns,png}
 * Run once before building: node scripts/convert-icons.js
 * 
 * Requires: npm install --save-dev sharp @electron/asar
 * For .icns on non-mac: npm install --save-dev png2icons
 */

'use strict';
const path  = require('path');
const fs    = require('fs');
const sharp = require('sharp');

const ROOT     = path.join(__dirname, '..');
const SVG_SRC  = path.join(ROOT, 'assets', 'chattering.svg');
const ICON_DIR = path.join(ROOT, 'assets', 'icons');

if (!fs.existsSync(ICON_DIR)) fs.mkdirSync(ICON_DIR, { recursive: true });

const SIZES = [16, 24, 32, 48, 64, 128, 256, 512];

async function run() {
  if (!fs.existsSync(SVG_SRC)) {
    console.error('ERROR: assets/chattering.svg not found');
    process.exit(1);
  }

  console.log('Converting SVG icon…');

  // Generate PNGs at multiple sizes
  for (const size of SIZES) {
    await sharp(SVG_SRC)
      .resize(size, size)
      .png()
      .toFile(path.join(ICON_DIR, `${size}x${size}.png`));
  }
  console.log('  ✓ PNGs generated');

  // 512×512 as the main PNG (used by Linux AppImage)
  await sharp(SVG_SRC)
    .resize(512, 512)
    .png()
    .toFile(path.join(ICON_DIR, 'chattering.png'));
  console.log('  ✓ chattering.png');

  // ICO for Windows — embed 16,32,48,64,128,256
  // electron-builder can build ICO from a 256×256 PNG directly
  await sharp(SVG_SRC)
    .resize(256, 256)
    .png()
    .toFile(path.join(ICON_DIR, 'chattering_256.png'));

  try {
    const png2icons = require('png2icons');
    const input = fs.readFileSync(path.join(ICON_DIR, 'chattering_256.png'));
    const ico   = png2icons.createICO(input, png2icons.BILINEAR, 0, false, true);
    fs.writeFileSync(path.join(ICON_DIR, 'chattering.ico'), ico);
    console.log('  ✓ chattering.ico');
  } catch {
    // Fallback: electron-builder will auto-convert the 256 PNG to ICO
    fs.copyFileSync(
      path.join(ICON_DIR, 'chattering_256.png'),
      path.join(ICON_DIR, 'chattering.ico')
    );
    console.log('  ✓ chattering.ico (PNG fallback — install png2icons for real ICO)');
  }

  // ICNS for macOS
  try {
    const png2icons = require('png2icons');
    const input = fs.readFileSync(path.join(ICON_DIR, 'chattering_256.png'));
    const icns  = png2icons.createICNS(input, png2icons.BILINEAR, 0);
    fs.writeFileSync(path.join(ICON_DIR, 'chattering.icns'), icns);
    console.log('  ✓ chattering.icns');
  } catch {
    console.log('  ⚠ chattering.icns skipped (install png2icons or run on macOS)');
  }

  console.log('\nDone. Icons are in assets/icons/');
}

run().catch(err => { console.error(err); process.exit(1); });
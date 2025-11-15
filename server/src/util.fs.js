const fs = require('fs');
const path = require('path');

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function sanitizeName(name) {
  return name.replace(/[^\w.\-]+/g, '_');
}

function relToAbs(rel) {
  return path.join(__dirname, '..', rel);
}

module.exports = { ensureDir, sanitizeName, relToAbs };

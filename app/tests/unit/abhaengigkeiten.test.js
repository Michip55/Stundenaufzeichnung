'use strict';
/** G-16: Jedes vom Server per require() geladene Paket steht direkt in package.json (nicht nur transitiv). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { builtinModules } = require('node:module');

const APP = path.join(__dirname, '..', '..');

function dateien(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? dateien(path.join(dir, e.name)) : e.name.endsWith('.js') ? [path.join(dir, e.name)] : []));
}

test('G-16: alle Server-Abhängigkeiten sind direkt eingetragen (mit festen Versionen im Lockfile)', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(APP, 'package.json'), 'utf8'));
  const lock = JSON.parse(fs.readFileSync(path.join(APP, 'package-lock.json'), 'utf8'));
  const direkt = new Set(Object.keys(pkg.dependencies || {}));
  const fehlen = new Set();
  for (const f of dateien(path.join(APP, 'server'))) {
    for (const m of fs.readFileSync(f, 'utf8').matchAll(/require\(\s*'([^'.][^']*)'\s*\)/g)) {
      const name = m[1].startsWith('@') ? m[1].split('/').slice(0, 2).join('/') : m[1].split('/')[0];
      if (name.startsWith('node:') || builtinModules.includes(name)) continue;
      if (!direkt.has(name)) fehlen.add(`${name} (${path.relative(APP, f)})`);
    }
  }
  assert.deepEqual([...fehlen], []);
  assert.equal(pkg.dependencies.saxes, '5.0.1');
  assert.equal(lock.packages[''].dependencies.saxes, '5.0.1');
  assert.equal(lock.packages['node_modules/saxes'].version, '5.0.1');
});

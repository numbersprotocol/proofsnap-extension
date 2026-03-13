#!/usr/bin/env node
/**
 * Pre-build validation: ensure package.json and manifest.template.json have the same version.
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

const pkg = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf-8'));
const manifest = JSON.parse(readFileSync(join(rootDir, 'manifest.template.json'), 'utf-8'));

if (pkg.version !== manifest.version) {
  console.error(
    `Version mismatch: package.json has "${pkg.version}" but manifest.template.json has "${manifest.version}".`
  );
  console.error('Please keep both versions in sync before building.');
  process.exit(1);
}

console.log(`✓ Version check passed: ${pkg.version}`);

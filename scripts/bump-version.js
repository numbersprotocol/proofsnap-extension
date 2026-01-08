#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

// Get version type from command line args (patch, minor, major)
const versionType = process.argv[2] || 'patch';

if (!['patch', 'minor', 'major'].includes(versionType)) {
  console.error('Usage: node bump-version.js [patch|minor|major]');
  process.exit(1);
}

function bumpVersion(version, type) {
  const parts = version.split('.').map(Number);

  switch (type) {
    case 'major':
      parts[0]++;
      parts[1] = 0;
      parts[2] = 0;
      break;
    case 'minor':
      parts[1]++;
      parts[2] = 0;
      break;
    case 'patch':
      parts[2]++;
      break;
  }

  return parts.join('.');
}

// Update manifest.template.json
const manifestPath = join(rootDir, 'manifest.template.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
const oldVersion = manifest.version;
const newVersion = bumpVersion(oldVersion, versionType);
manifest.version = newVersion;
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

// Update package.json
const packagePath = join(rootDir, 'package.json');
const packageJson = JSON.parse(readFileSync(packagePath, 'utf-8'));
packageJson.version = newVersion;
writeFileSync(packagePath, JSON.stringify(packageJson, null, 2) + '\n');

console.log(`Version bumped from ${oldVersion} to ${newVersion}`);
console.log(`NEW_VERSION=${newVersion}`);
console.log(`OLD_VERSION=${oldVersion}`);

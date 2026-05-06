#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

// Get version type or exact target version from command line args.
// Supported values: patch, minor, major, or an exact Chrome extension version
// such as 1.2.1.
const versionInput = process.argv[2] || 'patch';

const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

if (!['patch', 'minor', 'major'].includes(versionInput) && !VERSION_PATTERN.test(versionInput)) {
  console.error('Usage: node bump-version.js [patch|minor|major|x.y.z]');
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

function compareVersions(a, b) {
  const aParts = a.split('.').map(Number);
  const bParts = b.split('.').map(Number);

  for (let i = 0; i < 3; i++) {
    if (aParts[i] !== bParts[i]) {
      return aParts[i] - bParts[i];
    }
  }

  return 0;
}

function writeJson(path, data) {
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
}

// Update manifest.template.json
const manifestPath = join(rootDir, 'manifest.template.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
const oldVersion = manifest.version;
const newVersion = VERSION_PATTERN.test(versionInput) ? versionInput : bumpVersion(oldVersion, versionInput);

if (compareVersions(newVersion, oldVersion) <= 0) {
  console.error(`Error: new version (${newVersion}) must be greater than current version (${oldVersion})`);
  process.exit(1);
}

manifest.version = newVersion;
writeJson(manifestPath, manifest);

// Update package.json
const packagePath = join(rootDir, 'package.json');
const packageJson = JSON.parse(readFileSync(packagePath, 'utf-8'));
packageJson.version = newVersion;
writeJson(packagePath, packageJson);

// Update package-lock.json if present so release commits keep npm metadata in sync.
const packageLockPath = join(rootDir, 'package-lock.json');
try {
  const packageLockJson = JSON.parse(readFileSync(packageLockPath, 'utf-8'));
  packageLockJson.version = newVersion;
  if (packageLockJson.packages?.['']) {
    packageLockJson.packages[''].version = newVersion;
  }
  writeJson(packageLockPath, packageLockJson);
} catch (error) {
  if (error.code !== 'ENOENT') {
    throw error;
  }
}

console.log(`Version bumped from ${oldVersion} to ${newVersion}`);
console.log(`NEW_VERSION=${newVersion}`);
console.log(`OLD_VERSION=${oldVersion}`);

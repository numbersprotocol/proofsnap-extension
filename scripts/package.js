#!/usr/bin/env node

import { execSync } from 'child_process';
import { readFileSync, rmSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

console.log('Building extension...');

try {
  // Run build
  execSync('npm run build', { cwd: rootDir, stdio: 'inherit' });
} catch (error) {
  console.error('Build failed:', error.message);
  process.exit(1);
}

// Validate dist directory exists
const distDir = join(rootDir, 'dist');
if (!existsSync(distDir)) {
  console.error('Error: dist directory not found. Build may have failed.');
  process.exit(1);
}

// Read version from manifest
const manifestPath = join(rootDir, 'manifest.json');
if (!existsSync(manifestPath)) {
  console.error('Error: manifest.json not found. Run generate-manifest script first.');
  process.exit(1);
}

let manifest;
try {
  manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
} catch (error) {
  console.error('Error: Invalid manifest.json:', error.message);
  process.exit(1);
}

const version = manifest.version;
if (!version) {
  console.error('Error: No version found in manifest.json');
  process.exit(1);
}

console.log(`Packaging version ${version}...`);

// Create dist-zip directory if it doesn't exist
const distZipDir = join(rootDir, 'dist-zip');
try {
  rmSync(distZipDir, { recursive: true, force: true });
} catch (e) {
  // Directory doesn't exist, that's fine
}
mkdirSync(distZipDir, { recursive: true });

// Create zip file
const zipName = `proofsnap-extension-${version}.zip`;
const zipPath = join(distZipDir, zipName);

console.log(`Creating ${zipName}...`);

// Use native zip command with absolute path
try {
  execSync(`zip -r "${zipPath}" .`, {
    cwd: join(rootDir, 'dist'),
    stdio: 'inherit'
  });
} catch (error) {
  console.error('Error: Failed to create zip file:', error.message);
  process.exit(1);
}

// Validate zip was created
if (!existsSync(zipPath)) {
  console.error('Error: Zip file was not created');
  process.exit(1);
}

console.log(`✓ Package created: ${zipPath}`);
console.log(`ZIP_PATH=${zipPath}`);
console.log(`ZIP_NAME=${zipName}`);

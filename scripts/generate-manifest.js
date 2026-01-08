#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

// Read environment variables
const oauthClientId = process.env.OAUTH_CLIENT_ID;
const extensionKey = process.env.EXTENSION_KEY;

if (!oauthClientId || !extensionKey) {
  console.error('Error: OAUTH_CLIENT_ID and EXTENSION_KEY environment variables are required');
  process.exit(1);
}

// Read template
const templatePath = join(rootDir, 'manifest.template.json');
let manifestContent = readFileSync(templatePath, 'utf-8');

// Replace placeholders
manifestContent = manifestContent
  .replace('YOUR_OAUTH2_CLIENT_ID', oauthClientId)
  .replace('YOUR_EXTENSION_PUBLIC_KEY', extensionKey);

// Write manifest.json
const manifestPath = join(rootDir, 'manifest.json');
writeFileSync(manifestPath, manifestContent);

console.log('✓ manifest.json generated successfully from template');

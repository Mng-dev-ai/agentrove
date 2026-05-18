#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const file = join(root, 'docs/mybox/inventory/features.yaml');
const allowedStatuses = new Set(['keep', 'change', 'remove', 'defer', 'unknown']);
const allowedPriorities = new Set(['v1_required', 'v1_optional', 'later', 'remove']);

function fail(message) {
  console.error(`inventory check failed: ${message}`);
  process.exit(1);
}

let text = '';
try {
  text = readFileSync(file, 'utf8');
} catch {
  fail('docs/mybox/inventory/features.yaml is missing');
}

if (!/^features:\s*$/m.test(text)) {
  fail('features.yaml must contain a top-level "features:" key');
}

const records = text.split(/\n\s{2}- id:\s+/).slice(1);
if (records.length === 0) {
  fail('features.yaml must contain at least one feature record');
}

for (const rawRecord of records) {
  const record = `id: ${rawRecord}`;
  const id = record.match(/^id:\s*([A-Za-z0-9_-]+)/m)?.[1];
  const featureName = record.match(/^\s{4}feature_name:\s*(.+)$/m)?.[1];
  const status = record.match(/^\s{4}agentrove_status:\s*([A-Za-z0-9_-]+)/m)?.[1];
  const priority = record.match(/^\s{4}mybox_v1_priority:\s*([A-Za-z0-9_-]+)/m)?.[1];

  if (!id) fail('a feature record is missing id');
  if (!featureName) fail(`${id} is missing feature_name`);
  if (!status) fail(`${id} is missing agentrove_status`);
  if (!priority) fail(`${id} is missing mybox_v1_priority`);
  if (!allowedStatuses.has(status)) {
    fail(`${id} has invalid agentrove_status "${status}"`);
  }
  if (!allowedPriorities.has(priority)) {
    fail(`${id} has invalid mybox_v1_priority "${priority}"`);
  }
}

console.log(`inventory check ok: ${records.length} features`);

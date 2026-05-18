#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const graphFile = join(root, 'docs/mybox/graph/codebase.graph.json');
const reportDir = join(root, 'docs/mybox/graph');

const requiredHighRiskFiles = [
  'backend/app/api/endpoints/auth.py',
  'backend/app/api/endpoints/chat.py',
  'backend/app/api/endpoints/sandbox.py',
  'backend/app/api/endpoints/websocket.py',
  'backend/app/services/acp/adapters.py',
  'backend/app/services/streaming/types.py',
  'backend/app/services/git.py',
  'backend/app/services/terminal.py',
  'frontend/src/pages/ChatPage.tsx',
  'frontend/src/pages/LandingPage.tsx',
  'frontend/src/components/sandbox/git/DiffView.tsx',
  'frontend/src/components/sandbox/terminal/Container.tsx',
  'frontend/src/components/chat/tools/registry.tsx',
  'frontend/src/components/chat/message-bubble/segmentBuilder.ts',
  'frontend/src-tauri/Cargo.toml',
];

const requiredReports = [
  'codebase.graph.md',
  'frontend-routes.md',
  'backend-api.md',
  'stream-events.md',
  'adapter-boundaries.md',
  'mutation-surfaces.md',
  'auth-boundaries.md',
  'desktop-boundaries.md',
];

function fail(message) {
  console.error(`graph check failed: ${message}`);
  process.exit(1);
}

if (!existsSync(graphFile)) fail('docs/mybox/graph/codebase.graph.json is missing');

const graph = JSON.parse(readFileSync(graphFile, 'utf8'));
if (!Array.isArray(graph.nodes)) fail('graph nodes must be an array');
if (!Array.isArray(graph.edges)) fail('graph edges must be an array');

const nodeIds = new Set(graph.nodes.map((node) => node.id));
for (const file of requiredHighRiskFiles) {
  if (!nodeIds.has(file)) fail(`required high-risk node missing: ${file}`);
}

for (const report of requiredReports) {
  if (!existsSync(join(reportDir, report))) fail(`required report missing: ${report}`);
}

const mutationReport = readFileSync(join(reportDir, 'mutation-surfaces.md'), 'utf8');
for (const word of ['git', 'terminal', 'filesystem']) {
  if (!mutationReport.includes(word)) fail(`mutation-surfaces.md must mention ${word}`);
}

const authReport = readFileSync(join(reportDir, 'auth-boundaries.md'), 'utf8');
for (const word of ['auth.py', 'LoginPage.tsx']) {
  if (!authReport.includes(word)) fail(`auth-boundaries.md must mention ${word}`);
}

console.log(`graph check ok: ${graph.nodes.length} nodes, ${graph.edges.length} edges`);

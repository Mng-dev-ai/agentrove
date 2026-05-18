#!/usr/bin/env node
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

const root = process.cwd();
const outDir = join(root, 'docs/mybox/graph');
const ignored = new Set(['.git', 'node_modules', 'dist', 'target', '.venv', '__pycache__']);
const importantExts = new Set(['.ts', '.tsx', '.py', '.rs', '.json', '.toml']);

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

function walk(dir) {
  const entries = [];
  for (const name of readdirSync(dir).sort()) {
    if (ignored.has(name)) continue;
    const full = join(dir, name);
    const stats = statSync(full);
    if (stats.isDirectory()) {
      entries.push(...walk(full));
      continue;
    }
    if (importantExts.has(extname(name))) {
      entries.push(relative(root, full));
    }
  }
  return entries;
}

function read(file) {
  try {
    return readFileSync(join(root, file), 'utf8');
  } catch {
    return '';
  }
}

function addNode(nodes, id, type, label, meta = {}) {
  nodes.set(id, { id, type, label, ...meta });
}

function addEdge(edges, from, to, type, meta = {}) {
  edges.push({ from, to, type, ...meta });
}

function markdownTable(rows, headers) {
  return [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.map((cell) => String(cell).replaceAll('\n', ' ')).join(' | ')} |`),
  ].join('\n');
}

function extractExports(file) {
  const text = read(file);
  if (file.endsWith('.py')) {
    return [...text.matchAll(/^(?:async\s+def|def|class)\s+([A-Za-z0-9_]+)/gm)].map((match) => match[1]);
  }
  return [...text.matchAll(/export\s+(?:async\s+)?(?:function|const|class|interface|type|enum)\s+([A-Za-z0-9_]+)/g)].map(
    (match) => match[1],
  );
}

function extractRoutes(file) {
  const text = read(file);
  return [...text.matchAll(/@router\.(get|post|put|patch|delete|websocket)\(([^)]*)\)/g)].map((match) => ({
    method: match[1].toUpperCase(),
    path: match[2].split(',')[0].trim().replace(/^['"]|['"]$/g, ''),
  }));
}

function classifyFile(file) {
  if (file.startsWith('frontend/src/pages/')) return 'frontend.page';
  if (file.startsWith('frontend/src/components/')) return 'frontend.component';
  if (file.startsWith('frontend/src/store/')) return 'frontend.store';
  if (file.startsWith('frontend/src/hooks/')) return 'frontend.hook';
  if (file.startsWith('backend/app/api/endpoints/')) return 'backend.endpoint';
  if (file.startsWith('backend/app/services/acp/')) return 'backend.adapter';
  if (file.startsWith('backend/app/services/streaming/')) return 'backend.stream';
  if (file.startsWith('backend/app/services/')) return 'backend.service';
  if (file.startsWith('backend/app/models/')) return 'backend.model';
  if (file.startsWith('frontend/src-tauri/')) return 'desktop.tauri';
  return 'source.file';
}

function references(text, candidate) {
  const basename = candidate.split('/').pop()?.replace(/\.[^.]+$/, '');
  if (!basename) return false;
  return text.includes(basename);
}

function mutationKind(file, text) {
  const kinds = [];
  if (/git|branch|commit|diff|push|pull|restore/i.test(file + text)) kinds.push('git');
  if (/terminal|pty|websocket|command|shell/i.test(file + text)) kinds.push('terminal');
  if (/write|update_file|delete|download|sandbox|file/i.test(file + text)) kinds.push('filesystem');
  if (/secret|env_var|encrypt|decrypt/i.test(file + text)) kinds.push('secrets');
  if (/permission|approve|reject|allow|deny/i.test(file + text)) kinds.push('permissions');
  if (/http|github|email|websocket|external/i.test(file + text)) kinds.push('external_network');
  return [...new Set(kinds)];
}

function writeReport(name, title, body) {
  writeFileSync(join(outDir, name), `# ${title}\n\n${body.trim()}\n`);
}

mkdirSync(outDir, { recursive: true });

const allFiles = walk(root);
const files = allFiles.filter((file) => {
  if (file.endsWith('package-lock.json') || file.endsWith('Cargo.lock')) return false;
  return (
    file.startsWith('frontend/') ||
    file.startsWith('backend/') ||
    file.startsWith('desktop/') ||
    file.startsWith('scripts/') ||
    file === 'AGENTS.md' ||
    file === 'CLAUDE.md' ||
    file === 'README.md'
  );
});
const nodes = new Map();
const edges = [];

for (const file of files) {
  const type = classifyFile(file);
  addNode(nodes, file, type, file, {
    exports: extractExports(file).slice(0, 20),
    requiredHighRisk: requiredHighRiskFiles.includes(file),
  });
}

const frontendPages = files.filter((file) => file.startsWith('frontend/src/pages/'));
const frontendComponents = files.filter((file) => file.startsWith('frontend/src/components/'));
const backendEndpoints = files.filter((file) => file.startsWith('backend/app/api/endpoints/'));
const backendServices = files.filter((file) => file.startsWith('backend/app/services/'));
const backendModels = files.filter((file) => file.startsWith('backend/app/models/'));
const adapters = files.filter((file) => file.startsWith('backend/app/services/acp/'));
const streams = files.filter((file) => file.startsWith('backend/app/services/streaming/'));
const desktop = files.filter((file) => file.startsWith('frontend/src-tauri/'));

for (const page of frontendPages) {
  const text = read(page);
  for (const component of frontendComponents) {
    if (references(text, component)) addEdge(edges, page, component, 'renders');
  }
}

for (const endpoint of backendEndpoints) {
  const text = read(endpoint);
  for (const service of backendServices) {
    if (references(text, service)) addEdge(edges, endpoint, service, 'uses');
  }
  for (const model of backendModels) {
    if (references(text, model)) addEdge(edges, endpoint, model, 'uses');
  }
}

for (const service of backendServices) {
  const text = read(service);
  for (const adapter of adapters) {
    if (service !== adapter && references(text, adapter)) addEdge(edges, service, adapter, 'calls');
  }
  for (const stream of streams) {
    if (service !== stream && references(text, stream)) addEdge(edges, service, stream, 'emits');
  }
}

const mutationFiles = [];
for (const file of files) {
  const text = read(file);
  const kinds = mutationKind(file, text);
  if (!kinds.length) continue;
  mutationFiles.push({ file, kinds });
  for (const kind of kinds) {
    const id = `mutation:${kind}`;
    addNode(nodes, id, 'mutation.surface', kind);
    addEdge(edges, file, id, 'mutates');
  }
}

const authFiles = files.filter((file) => /auth|Login|Signup|ResetPassword|ForgotPassword|EmailVerification|security|user_manager/i.test(file));
for (const file of authFiles) {
  addNode(nodes, `auth:${file}`, 'auth.boundary', file);
  addEdge(edges, file, `auth:${file}`, 'requires_auth');
}

const reports = {
  frontendRoutes: 'docs/mybox/graph/frontend-routes.md',
  backendApi: 'docs/mybox/graph/backend-api.md',
  streamEvents: 'docs/mybox/graph/stream-events.md',
  adapterBoundaries: 'docs/mybox/graph/adapter-boundaries.md',
  mutationSurfaces: 'docs/mybox/graph/mutation-surfaces.md',
  authBoundaries: 'docs/mybox/graph/auth-boundaries.md',
  desktopBoundaries: 'docs/mybox/graph/desktop-boundaries.md',
};

const graph = {
  generatedAt: new Date().toISOString(),
  note: 'Deterministic G1 graph v0. Uses filesystem scans and lightweight regex extraction; advisory graph tools may supplement but do not replace this graph.',
  nodes: [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id)),
  edges: edges.sort((a, b) => `${a.from}:${a.to}:${a.type}`.localeCompare(`${b.from}:${b.to}:${b.type}`)),
  reports,
};

writeFileSync(join(outDir, 'codebase.graph.json'), `${JSON.stringify(graph, null, 2)}\n`);

writeReport(
  'codebase.graph.md',
  'Codebase Graph v0',
  `This is the deterministic MyBox G1 graph. It is generated by \`scripts/mybox/graph/build-codebase-graph.mjs\`.

External tools such as Graphify may be useful as scouts, but their output is advisory only. This graph is the source of truth for G1.

${markdownTable(
  [
    ['Nodes', graph.nodes.length],
    ['Edges', graph.edges.length],
    ['Required high-risk files', requiredHighRiskFiles.length],
    ['Graphify advisory pass', 'deferred in G1 unless a later run adds docs/mybox/graph/external/graphify-report.md'],
  ],
  ['Metric', 'Value'],
)}`,
);

writeReport(
  'frontend-routes.md',
  'Frontend Routes and Pages',
  markdownTable(
    frontendPages.map((file) => [file, extractExports(file).join(', ') || 'default/page module']),
    ['Page', 'Exports'],
  ),
);

writeReport(
  'backend-api.md',
  'Backend API Endpoints',
  markdownTable(
    backendEndpoints.map((file) => {
      const routes = extractRoutes(file)
        .map((route) => `${route.method} ${route.path}`)
        .join('; ');
      return [file, routes || 'no router markers found by v0 scanner'];
    }),
    ['Endpoint file', 'Routes'],
  ),
);

writeReport(
  'stream-events.md',
  'Stream Events',
  `${markdownTable(streams.map((file) => [file, extractExports(file).join(', ') || 'stream module']), ['File', 'Exports'])}

Known frontend consumers:

${markdownTable(
  [
    ['frontend/src/contexts/ChatContext.tsx', 'chat stream context and event application'],
    ['frontend/src/components/chat/message-bubble/segmentBuilder.ts', 'message segment construction'],
    ['frontend/src/components/chat/message-bubble/ThinkingBlock.tsx', 'thinking summary rendering'],
    ['frontend/src/components/chat/tools/registry.tsx', 'tool-card renderer selection'],
  ],
  ['Consumer', 'Purpose'],
)}`,
);

writeReport(
  'adapter-boundaries.md',
  'Adapter Boundaries',
  `${markdownTable(adapters.map((file) => [file, extractExports(file).join(', ') || 'adapter module']), ['File', 'Exports'])}

Known first-class Agentrove provider names appear in \`backend/app/services/acp/adapters.py\` and frontend provider-specific tool/icon modules. MyBox harness entries must later be registry-driven rather than presentation-component hardcoded.`,
);

writeReport(
  'mutation-surfaces.md',
  'Mutation Surfaces',
  markdownTable(
    mutationFiles
      .filter(({ kinds }) => kinds.some((kind) => ['git', 'terminal', 'filesystem', 'secrets', 'permissions'].includes(kind)))
      .map(({ file, kinds }) => [file, kinds.join(', ')]),
    ['File', 'Detected mutation candidates'],
  ),
);

writeReport(
  'auth-boundaries.md',
  'Auth Boundaries',
  markdownTable(authFiles.map((file) => [file, classifyFile(file)]), ['File', 'Type']),
);

writeReport(
  'desktop-boundaries.md',
  'Desktop Boundaries',
  `${markdownTable(desktop.map((file) => [file, classifyFile(file)]), ['File', 'Type'])}

Host-provider boundary:

${markdownTable(
  [
    ['backend/app/services/sandbox_providers/host_provider.py', 'local host sandbox provider'],
    ['backend/app/services/sandbox_providers/docker_provider.py', 'Docker sandbox provider'],
    ['backend/app/services/sandbox.py', 'sandbox service facade'],
  ],
  ['File', 'Purpose'],
)}`,
);

console.log(`codebase graph ok: ${graph.nodes.length} nodes, ${graph.edges.length} edges`);

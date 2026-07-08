import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const dir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(dir, '..');
const backendDir = join(rootDir, 'backend');
const sidecarDir = join(rootDir, 'frontend', 'backend-sidecar');

const PYTHON_VERSION = '3.12.12';
const NODE_VERSION = '22.12.0';
const RELEASE_TAG = '20260211';
const RIPGREP_VERSION = '14.1.1';
const CLAUDE_AGENT_ACP_VERSION = '0.57.0';
const CODEX_ACP_VERSION = '0.15.0';
const GET_PIP_URL = 'https://bootstrap.pypa.io/get-pip.py';

const platform = process.platform;
const arch = process.arch;
const forceClean = process.argv.includes('--clean');

if (platform !== 'darwin' || !['arm64', 'x64'].includes(arch)) {
  throw new Error(`Desktop build supports macOS arm64/x64 only (received: ${arch}/${platform})`);
}

const ARCH_TRIPLE = arch === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin';

const pythonBin = join(sidecarDir, 'python', 'bin', 'python3');
const nodeDir = join(sidecarDir, 'node');
const nodeBin = join(nodeDir, 'bin', 'node');
const npmBin = join(nodeDir, 'bin', 'npm');
const sidecarBinDir = join(sidecarDir, 'bin');
const rgBin = join(sidecarDir, 'bin', 'rg');
const claudeAcpBin = join(sidecarBinDir, 'claude-agent-acp');
const codexAcpBin = join(sidecarBinDir, 'codex-acp');

const PYTHON_STAMP = `${PYTHON_VERSION}+${RELEASE_TAG}-${arch}-${platform}`;
const NODE_STAMP = `${NODE_VERSION}-${arch}-${platform}`;
const RG_STAMP = `${RIPGREP_VERSION}-${arch}-${platform}`;
const ACP_STAMP = `${CLAUDE_AGENT_ACP_VERSION}-${CODEX_ACP_VERSION}-${NODE_STAMP}`;

function stampPath(name) {
  return join(sidecarDir, `.${name}-stamp`);
}

function upToDate(name, value, ...required) {
  const stamp = stampPath(name);
  if (!existsSync(stamp)) return false;
  if (required.some((f) => !existsSync(f))) return false;
  return readFileSync(stamp, 'utf-8').trim() === value;
}

function writeStamp(name, value) {
  writeFileSync(stampPath(name), `${value}\n`);
}

function download(url, outputPath) {
  execFileSync('curl', ['-fsSL', '-o', outputPath, url], { stdio: 'inherit' });
}

function extractTar(archivePath, destDir) {
  mkdirSync(destDir, { recursive: true });
  execFileSync('tar', ['-xzf', archivePath, '-C', destDir], { stdio: 'inherit' });
}

function depsStampValue() {
  const requirements = readFileSync(join(dir, 'requirements.txt'), 'utf-8');
  return JSON.stringify({ requirements, python: PYTHON_STAMP });
}

function fetchPython() {
  const archive = join(sidecarDir, 'python.tar.gz');
  const name = `cpython-${PYTHON_VERSION}+${RELEASE_TAG}-${ARCH_TRIPLE}-install_only_stripped.tar.gz`;
  const url = `https://github.com/astral-sh/python-build-standalone/releases/download/${RELEASE_TAG}/${name}`;
  console.log(`Downloading Python ${PYTHON_VERSION}...`);
  rmSync(join(sidecarDir, 'python'), { recursive: true, force: true });
  try {
    download(url, archive);
    extractTar(archive, sidecarDir);
  } finally {
    rmSync(archive, { force: true });
  }
  if (!existsSync(pythonBin)) throw new Error(`Python binary not found at ${pythonBin}`);
  writeStamp('python', PYTHON_STAMP);
}

function fetchNode() {
  const archive = join(sidecarDir, 'node.tar.gz');
  const extractedDir = join(sidecarDir, `node-v${NODE_VERSION}-darwin-${arch}`);
  const url = `https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-darwin-${arch}.tar.gz`;
  console.log(`Downloading Node ${NODE_VERSION}...`);
  rmSync(extractedDir, { recursive: true, force: true });
  rmSync(nodeDir, { recursive: true, force: true });
  try {
    download(url, archive);
    extractTar(archive, sidecarDir);
    if (!existsSync(join(extractedDir, 'bin', 'node'))) {
      throw new Error(`Node binary not found at ${join(extractedDir, 'bin', 'node')}`);
    }
    renameSync(extractedDir, nodeDir);
  } finally {
    rmSync(archive, { force: true });
    rmSync(extractedDir, { recursive: true, force: true });
  }
  writeStamp('node', NODE_STAMP);
}

// Tauri's resource bundler dereferences symlinks when copying the sidecar
// into the .app, turning `bin/npx` (a symlink to ../lib/node_modules/npm/bin/npx-cli.js)
// into a verbatim copy of that script. Its `require('../lib/cli.js')` then
// resolves relative to bin/ instead of lib/node_modules/npm/bin/ and crashes.
// Replace each symlink with a bash launcher that invokes the real script
// through the bundled node — survives any copy/bundle step.
function replaceNodeShims() {
  const shims = [
    { name: 'npm', target: 'lib/node_modules/npm/bin/npm-cli.js' },
    { name: 'npx', target: 'lib/node_modules/npm/bin/npx-cli.js' },
    { name: 'corepack', target: 'lib/node_modules/corepack/dist/corepack.js' },
  ];
  for (const { name, target } of shims) {
    const shimPath = join(nodeDir, 'bin', name);
    if (!existsSync(join(nodeDir, target))) continue;
    rmSync(shimPath, { force: true });
    writeFileSync(
      shimPath,
      '#!/bin/bash\n' +
        'SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"\n' +
        `exec "$SCRIPT_DIR/node" "$SCRIPT_DIR/../${target}" "$@"\n`,
    );
    chmodSync(shimPath, 0o755);
  }
}

function fetchRipgrep() {
  const innerDir = `ripgrep-${RIPGREP_VERSION}-${ARCH_TRIPLE}`;
  const url = `https://github.com/BurntSushi/ripgrep/releases/download/${RIPGREP_VERSION}/${innerDir}.tar.gz`;
  const archive = join(sidecarDir, 'rg.tar.gz');
  // Extract into a scratch dir so we can pluck out just the `rg` binary and
  // drop the accompanying docs/completions — keeps the .dmg lean.
  const extractDir = join(sidecarDir, '_rg-extract');
  console.log(`Downloading ripgrep ${RIPGREP_VERSION}...`);
  rmSync(extractDir, { recursive: true, force: true });
  try {
    download(url, archive);
    extractTar(archive, extractDir);
    const rgSource = join(extractDir, innerDir, 'rg');
    if (!existsSync(rgSource)) throw new Error(`rg binary not found at ${rgSource}`);
    mkdirSync(sidecarBinDir, { recursive: true });
    copyFileSync(rgSource, rgBin);
    chmodSync(rgBin, 0o755);
  } finally {
    rmSync(archive, { force: true });
    rmSync(extractDir, { recursive: true, force: true });
  }
  writeStamp('rg', RG_STAMP);
}

function installPip() {
  console.log('Installing pip...');
  const getPip = join(sidecarDir, 'get-pip.py');
  try {
    download(GET_PIP_URL, getPip);
    execFileSync(pythonBin, [getPip, '--disable-pip-version-check'], { stdio: 'inherit' });
  } finally {
    rmSync(getPip, { force: true });
  }
}

function installPyDeps() {
  try {
    execFileSync(pythonBin, ['-m', 'pip', '--version'], { stdio: 'ignore' });
  } catch {
    installPip();
  }
  console.log('Installing dependencies...');
  execFileSync(
    pythonBin,
    [
      '-m', 'pip', 'install', '-q',
      '--disable-pip-version-check',
      '--no-warn-script-location',
      '-r', join(dir, 'requirements.txt'),
    ],
    { cwd: backendDir, stdio: 'inherit' },
  );
  writeStamp('deps', depsStampValue());
}

function installAcpAdapters() {
  console.log('Installing ACP adapters...');
  execFileSync(
    npmBin,
    [
      'install', '--prefix', sidecarDir,
      '--omit=dev', '--no-audit', '--no-fund', '--package-lock=false',
      `@agentclientprotocol/claude-agent-acp@${CLAUDE_AGENT_ACP_VERSION}`,
      `@zed-industries/codex-acp@${CODEX_ACP_VERSION}`,
    ],
    { stdio: 'inherit' },
  );
  writeStamp('acp', ACP_STAMP);
}

function writeAcpLauncher(name, packageEntry) {
  const launcher = join(sidecarBinDir, name);
  mkdirSync(sidecarBinDir, { recursive: true });
  writeFileSync(
    launcher,
    '#!/bin/bash\n' +
      'SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"\n' +
      `exec "$SCRIPT_DIR/../node/bin/node" "$SCRIPT_DIR/../node_modules/${packageEntry}" "$@"\n`,
  );
  chmodSync(launcher, 0o755);
}

function writeAcpLaunchers() {
  writeAcpLauncher('claude-agent-acp', '@agentclientprotocol/claude-agent-acp/dist/index.js');
  writeAcpLauncher('codex-acp', '@zed-industries/codex-acp/bin/codex-acp.js');
}

function copySource() {
  console.log('Copying source...');
  const filter = (src) => !src.includes('__pycache__') && !src.endsWith('.pyc');
  rmSync(join(sidecarDir, 'app'), { recursive: true, force: true });
  rmSync(join(sidecarDir, 'migrations'), { recursive: true, force: true });
  cpSync(join(backendDir, 'app'), join(sidecarDir, 'app'), { recursive: true, filter });
  cpSync(join(backendDir, 'migrations'), join(sidecarDir, 'migrations'), { recursive: true, filter });
  copyFileSync(join(backendDir, 'alembic.ini'), join(sidecarDir, 'alembic.ini'));
  copyFileSync(join(backendDir, 'migrate.py'), join(sidecarDir, 'migrate.py'));
  copyFileSync(join(dir, 'entry.py'), join(sidecarDir, 'entry.py'));
  // Bundle the MCP server alongside the backend so agent.py can compute its path
  // (sidecar/app/services/agent.py -> sidecar/mcp-server/server.py) without config
  rmSync(join(sidecarDir, 'mcp-server'), { recursive: true, force: true });
  cpSync(join(rootDir, 'mcp-server'), join(sidecarDir, 'mcp-server'), {
    recursive: true,
    filter: (src) =>
      !src.includes('__pycache__') && !src.endsWith('.pyc') && !src.includes('.venv'),
  });
}

function writeLauncher() {
  const launcher = join(sidecarDir, 'agentrove-backend');
  // Prepend the bundled bin dir to PATH so the user's shell (spawned via
  // `bash -lc` by the host sandbox provider) can find our bundled `rg`
  // without any extra install step. Login shells still run the user's rc
  // files afterwards, so any user-installed `rg` earlier in PATH keeps
  // precedence — this is a floor, not a ceiling.
  writeFileSync(
    launcher,
    '#!/bin/bash\n' +
      'SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"\n' +
      'export PYTHONPATH="$SCRIPT_DIR"\n' +
      'export PATH="$SCRIPT_DIR/bin:$SCRIPT_DIR/node/bin:$PATH"\n' +
      'exec "$SCRIPT_DIR/python/bin/python3" "$SCRIPT_DIR/entry.py" "$@"\n',
  );
  chmodSync(launcher, 0o755);
}

function run() {
  if (forceClean && existsSync(sidecarDir)) {
    rmSync(sidecarDir, { recursive: true, force: true });
  }
  mkdirSync(sidecarDir, { recursive: true });

  const pythonChanged = !upToDate('python', PYTHON_STAMP, pythonBin);
  if (pythonChanged) fetchPython();
  else console.log('Python already installed, skipping download.');

  const nodeChanged = !upToDate('node', NODE_STAMP, nodeBin, npmBin);
  if (nodeChanged) fetchNode();
  else console.log('Node already installed, skipping download.');
  replaceNodeShims();

  if (!nodeChanged && upToDate('acp', ACP_STAMP, claudeAcpBin, codexAcpBin)) {
    console.log('ACP adapters already installed, skipping install.');
  } else {
    installAcpAdapters();
  }

  writeAcpLaunchers();

  if (!pythonChanged && upToDate('deps', depsStampValue())) {
    console.log('Dependencies up to date, skipping install.');
  } else {
    installPyDeps();
  }

  if (upToDate('rg', RG_STAMP, rgBin)) {
    console.log('ripgrep already installed, skipping download.');
  } else {
    fetchRipgrep();
  }

  copySource();
  writeLauncher();
  console.log('Done');
}

try {
  run();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

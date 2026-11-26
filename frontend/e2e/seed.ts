import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  API_ORIGIN,
  CHAT_TITLE,
  SMOKE_DIR,
} from './playwright.config';

const REPO_DIR = path.join(SMOKE_DIR, 'repo');

function git(...args: string[]): void {
  execFileSync('git', args, { cwd: REPO_DIR });
}

function createFixtureRepo(): void {
  mkdirSync(REPO_DIR, { recursive: true });
  git('init', '-q');
  writeFileSync(path.join(REPO_DIR, 'hello.ts'), 'export const greeting = "hello";\n');
  git('add', 'hello.ts');
  git('-c', 'user.name=smoke', '-c', 'user.email=smoke@example.invalid', 'commit', '-qm', 'init');
  writeFileSync(path.join(REPO_DIR, 'hello.ts'), 'export const greeting = "hello, smoke";\n');
}

async function api<T>(endpoint: string, init: RequestInit): Promise<T> {
  const response = await fetch(`${API_ORIGIN}/api/v1${endpoint}`, init);
  if (!response.ok) {
    throw new Error(`${endpoint}: ${response.status} ${await response.text()}`);
  }
  return (await response.json()) as T;
}

export default async function seed(): Promise<() => void> {
  createFixtureRepo();
  const { access_token } = await api<{ access_token: string }>('/auth/jwt/login', {
    method: 'POST',
    body: new URLSearchParams({ username: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  const headers = { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' };
  const workspace = await api<{ id: string }>('/workspaces', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      name: 'smoke',
      source_type: 'local',
      workspace_path: REPO_DIR,
      sandbox_provider: 'host',
    }),
  });
  await api('/chat/chats', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      title: CHAT_TITLE,
      model_id: 'opencode:opencode/big-pickle',
      workspace_id: workspace.id,
    }),
  });
  return () => rmSync(SMOKE_DIR, { recursive: true, force: true });
}

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fixture from '../../src-tauri/fixtures/machine_vault_protocol.json';

vi.mock('@/utils/platform', () => ({ isDesktopApp: () => false }));

type VaultModule = typeof import('@/services/machineVault');

interface SentRequest {
  method?: string;
  url: string;
  timeout_ms?: number;
  json?: unknown;
  bearer?: string;
}

interface FixtureResponse {
  status?: number;
  json?: unknown;
  text?: string;
  network_error?: boolean;
}

type ArgName = 'machine_id' | 'url' | 'secret' | 'device_name' | 'device_id';

interface Step {
  op: string;
  args: Partial<Record<ArgName, string>>;
  exchanges?: { request: SentRequest; response: FixtureResponse }[];
  expect: { ok?: unknown; error?: string };
}

interface Case {
  name: string;
  paired?: boolean;
  steps: Step[];
}

const ORIGIN = 'https://machine.example:8443';
const pairedSetup: Step = fixture.paired_setup;
const cases: Case[] = fixture.cases;

const sent: SentRequest[] = [];
const inits: RequestInit[] = [];
const timeouts = new WeakMap<AbortSignal, number>();
let responses: (FixtureResponse | Promise<Response>)[] = [];

function jwt(exp: number): string {
  return `header.${btoa(JSON.stringify({ exp }))}.signature`;
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function recordingTimeout(ms: number): AbortSignal {
  const { signal } = new AbortController();
  timeouts.set(signal, ms);
  return signal;
}

async function fakeFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const authorization = new Headers(init.headers).get('Authorization');
  sent.push({
    method: init.method,
    url,
    timeout_ms: init.signal ? timeouts.get(init.signal) : undefined,
    ...(typeof init.body === 'string' ? { json: JSON.parse(init.body) } : {}),
    ...(authorization === null ? {} : { bearer: authorization.replace(/^Bearer /, '') }),
  });
  inits.push(init);
  const response = responses.shift();
  if (!response || ('network_error' in response && response.network_error)) {
    throw new TypeError('Failed to fetch');
  }
  if (response instanceof Promise) return response;
  if (response.status !== undefined && response.status >= 300 && response.status < 400) {
    if (init.redirect === 'error') throw new TypeError('Failed to fetch');
    if (init.redirect === 'manual') {
      return Object.defineProperties(new Response(null), {
        type: { value: 'opaqueredirect' },
        status: { value: 0 },
        ok: { value: false },
      });
    }
  }
  const body = response.json === undefined ? response.text : JSON.stringify(response.json);
  return new Response(body ?? null, { status: response.status });
}

function arg(step: Step, name: ArgName): string {
  const value = step.args[name];
  if (value === undefined) throw new Error(`${step.op} step is missing ${name}`);
  return value;
}

function call({ machineVault }: VaultModule, step: Step): Promise<unknown> {
  switch (step.op) {
    case 'pair':
      return machineVault.pair(
        arg(step, 'machine_id'),
        arg(step, 'url'),
        arg(step, 'secret'),
        arg(step, 'device_name'),
      );
    case 'refresh':
      return machineVault.refresh(arg(step, 'machine_id'));
    case 'unpair':
      return machineVault.unpair(arg(step, 'machine_id'), arg(step, 'device_id'));
    case 'forget':
      return machineVault.forget(arg(step, 'machine_id'));
    default:
      throw new Error(`Unknown fixture op ${step.op}`);
  }
}

async function outcomeOf(vault: VaultModule, operation: Promise<unknown>) {
  try {
    return { ok: (await operation) ?? null };
  } catch (error) {
    return { error: error instanceof vault.MachineVaultError ? error.code : String(error) };
  }
}

async function runStep(vault: VaultModule, step: Step, label: string): Promise<void> {
  const exchanges = step.exchanges ?? [];
  sent.length = 0;
  inits.length = 0;
  responses = exchanges.map((exchange) => exchange.response);
  const outcome = await outcomeOf(vault, call(vault, step));
  expect(outcome, label).toEqual(step.expect);
  expect(sent, label).toEqual(exchanges.map((exchange) => exchange.request));
}

async function loadVault(paired: boolean): Promise<VaultModule> {
  const vault = await import('@/services/machineVault');
  if (paired) await runStep(vault, pairedSetup, 'paired_setup');
  sent.length = 0;
  return vault;
}

beforeEach(() => {
  vi.resetModules();
  sent.length = 0;
  inits.length = 0;
  responses = [];
  vi.spyOn(AbortSignal, 'timeout').mockImplementation(recordingTimeout);
  vi.stubGlobal('fetch', fakeFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('browserVault shared protocol cases', () => {
  it.each(cases)('$name', async ({ paired, steps }) => {
    const vault = await loadVault(paired === true);
    for (const [index, step] of steps.entries()) {
      await runStep(vault, step, `step ${index + 1} (${step.op})`);
    }
  });
});

describe('browserVault per-machine lock', () => {
  it('runs concurrent operations on one machine id sequentially', async () => {
    const vault = await loadVault(true);
    let releaseFirst: (response: Response) => void = () => undefined;
    responses = [
      new Promise<Response>((resolve) => {
        releaseFirst = resolve;
      }),
      { status: 200, json: { access_token: jwt(1900001800), refresh_token: 'refresh-2' } },
    ];

    const first = vault.machineVault.refresh('machine-1');
    const second = vault.machineVault.refresh('machine-1');
    await settle();
    expect(sent.map((request) => request.json)).toEqual([{ refresh_token: 'refresh-0' }]);

    releaseFirst(jsonResponse({ access_token: jwt(1900000900), refresh_token: 'refresh-1' }));
    await expect(first).resolves.toMatchObject({ expires_at: 1900000900 });
    await expect(second).resolves.toMatchObject({ expires_at: 1900001800 });
    expect(sent.map((request) => request.json)).toEqual([
      { refresh_token: 'refresh-0' },
      { refresh_token: 'refresh-1' },
    ]);
  });

  it('does not block a different machine id', async () => {
    const vault = await loadVault(false);
    responses = [
      new Promise<Response>(() => undefined),
      {
        status: 200,
        json: {
          access_token: jwt(1900000000),
          refresh_token: 'refresh-0',
          device_id: 'device-2',
          instance_id: 'instance-2',
        },
      },
    ];

    void vault.machineVault.pair('machine-1', ORIGIN, 'secret-1', 'Laptop');
    await expect(
      vault.machineVault.pair('machine-2', 'https://other.example', 'secret-2', 'Laptop'),
    ).resolves.toMatchObject({ device_id: 'device-2' });
    expect(sent.map((request) => request.url)).toEqual([
      `${ORIGIN}/api/v1/auth/pair`,
      'https://other.example/api/v1/auth/pair',
    ]);
  });
});

describe('browserVault browser-only behaviour', () => {
  it('reports every fetch failure as unreachable, never tls', async () => {
    const vault = await loadVault(false);
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('net::ERR_CERT_AUTHORITY_INVALID')));
    await expect(
      vault.machineVault.pair('machine-1', ORIGIN, 'secret', 'Laptop'),
    ).rejects.toMatchObject({ code: 'unreachable' });

    vi.stubGlobal('fetch', () => Promise.reject(new DOMException('timed out', 'TimeoutError')));
    await expect(vault.machineVault.probe(ORIGIN)).rejects.toMatchObject({ code: 'unreachable' });
  });

  it('sends requests without cookies or cache and refuses redirects', async () => {
    await runStep(await loadVault(false), pairedSetup, 'pair');
    expect(inits[0]).toMatchObject({
      redirect: 'manual',
      credentials: 'omit',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
    });
  });

  it('probe sends a no-cors health request and accepts any response', async () => {
    const vault = await loadVault(false);
    for (const response of [new Response(null, { status: 503 }), Response.error()]) {
      sent.length = 0;
      inits.length = 0;
      responses = [Promise.resolve(response)];
      await expect(vault.machineVault.probe(`${ORIGIN}/some/page`)).resolves.toBeUndefined();
      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({ url: `${ORIGIN}/health`, timeout_ms: 5000 });
      expect(inits[0]).toMatchObject({
        mode: 'no-cors',
        credentials: 'omit',
        cache: 'no-store',
      });
      expect(inits[0].method).toBeUndefined();
    }

    await expect(vault.machineVault.probe('http://machine.example')).rejects.toMatchObject({
      code: 'invalid_input',
    });
  });
});

// @vitest-environment jsdom

import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import toast from 'react-hot-toast';
import { queryKeys } from '@/hooks/queries/queryKeys';
import { useInputFileOperations } from '@/hooks/useInputFileOperations';
import { instanceService } from '@/services/instanceService';
import { useMachineStore } from '@/store/machineStore';
import type { InstanceInfo } from '@/types/machine.types';

vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn() } }));

const MIB = 1024 * 1024;
const SMALL_ID = 'small';
const LARGE_ID = 'large';
const INSTANCES: Record<string, InstanceInfo> = {
  [SMALL_ID]: {
    instance_id: 'instance-small',
    max_upload_size: 2 * MIB,
    allowed_file_types: ['image/png'],
  },
  [LARGE_ID]: {
    instance_id: 'instance-large',
    max_upload_size: 10 * MIB,
    allowed_file_types: ['image/png'],
  },
};

let queryClient: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

function image(name: string, size: number): File {
  return new File([new Uint8Array(size)], name, { type: 'image/png' });
}

async function attachOn(machineId: string, files: File[]): Promise<string[]> {
  const onAttach = vi.fn<(files: File[]) => void>();
  const { result } = renderHook(
    () => useInputFileOperations({ machineId, attachedFiles: [], onAttach }),
    { wrapper },
  );
  await waitFor(() =>
    expect(queryClient.getQueryState(queryKeys.machine.instance(machineId))?.status).toBe(
      'success',
    ),
  );
  act(() => result.current.handleFileSelect(files));
  return (onAttach.mock.calls[0]?.[0] ?? []).map((file) => file.name);
}

describe('composer attachment preflight', () => {
  beforeEach(() => {
    queryClient = new QueryClient();
    vi.mocked(toast.error).mockClear();
    useMachineStore.setState({
      machines: [
        { id: SMALL_ID, name: 'Small', url: 'https://small.test', pairing: null },
        { id: LARGE_ID, name: 'Large', url: 'https://large.test', pairing: null },
      ],
      connections: { [SMALL_ID]: { status: 'online' }, [LARGE_ID]: { status: 'online' } },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    queryClient.clear();
    useMachineStore.setState({ machines: [], connections: {} });
  });

  it("applies the destination machine's advertised size limit", async () => {
    vi.spyOn(instanceService, 'getInstance').mockImplementation(
      async (machineId) => INSTANCES[machineId],
    );

    const onSmall = await attachOn(SMALL_ID, [image('a.png', MIB), image('b.png', 6 * MIB)]);
    expect(toast.error).toHaveBeenCalledWith('File "b.png" exceeds 2.0 MB limit');
    const onLarge = await attachOn(LARGE_ID, [image('b.png', 6 * MIB), image('c.png', 11 * MIB)]);

    expect(onSmall).toEqual(['a.png']);
    expect(onLarge).toEqual(['b.png']);
    expect(toast.error).toHaveBeenLastCalledWith('File "c.png" exceeds 10.0 MB limit');
  });

  it('falls back to 5 MiB and the default types when the server omits the fields', async () => {
    vi.spyOn(instanceService, 'getInstance').mockResolvedValue({ instance_id: 'older-backend' });

    const attached = await attachOn(SMALL_ID, [
      image('a.png', 5 * MIB),
      image('b.png', 5 * MIB + 1),
      new File(['document'], 'doc.pdf', { type: 'application/pdf' }),
      new File(['text'], 'notes.txt', { type: 'text/plain' }),
    ]);

    expect(attached).toEqual(['a.png', 'doc.pdf']);
    expect(toast.error).toHaveBeenCalledWith('File "b.png" exceeds 5.0 MB limit');
    expect(toast.error).toHaveBeenCalledWith('File "notes.txt" is not a supported file type');
  });
});

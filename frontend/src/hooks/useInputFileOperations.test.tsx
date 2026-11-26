// @vitest-environment jsdom

import { useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import toast from 'react-hot-toast';
import { queryKeys } from '@/hooks/queries/queryKeys';
import { useInputFileOperations } from '@/hooks/useInputFileOperations';
import { instanceService } from '@/services/instanceService';
import { useMachineStore } from '@/store/machineStore';
import type { InstanceInfo } from '@/types/machine.types';
import { convertDataUrlToUploadedFile } from '@/utils/file';

vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@/utils/file', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/file')>()),
  convertDataUrlToUploadedFile: vi.fn(),
}));

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

function useAttachedFileOperations(machineId: string, initialFiles: File[]) {
  const [files, setFiles] = useState(initialFiles);
  const operations = useInputFileOperations({
    machineId,
    attachedFiles: files,
    onAttach: setFiles,
  });
  return { files, setFiles, operations };
}

async function renderOperations(machineId: string, initialFiles: File[] = []) {
  const rendered = renderHook(() => useAttachedFileOperations(machineId, initialFiles), {
    wrapper,
  });
  await waitFor(() =>
    expect(queryClient.getQueryState(queryKeys.machine.instance(machineId))?.status).toBe(
      'success',
    ),
  );
  return rendered;
}

async function attachOn(machineId: string, files: File[]): Promise<string[]> {
  const { result } = await renderOperations(machineId);
  act(() => result.current.operations.handleFileSelect(files));
  return names(result.current.files);
}

async function startDrawingSave(initialFiles: File[], editIndex: number) {
  let finishConversion!: (file: File) => void;
  vi.mocked(convertDataUrlToUploadedFile).mockReturnValue(
    new Promise<File>((resolve) => {
      finishConversion = resolve;
    }),
  );
  vi.spyOn(instanceService, 'getInstance').mockImplementation(
    async (machineId) => INSTANCES[machineId],
  );
  const { result } = await renderOperations(SMALL_ID, initialFiles);
  act(() => result.current.operations.handleDrawClick(editIndex));
  let saving!: Promise<void>;
  act(() => {
    saving = result.current.operations.handleDrawingSave('data:image/png;base64,');
  });
  const finish = async (file: File) => {
    await act(async () => {
      finishConversion(file);
      await saving;
    });
  };
  return { result, finish };
}

function names(files: File[]): string[] {
  return files.map((file) => file.name);
}

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

describe('composer attachment preflight', () => {
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

describe('drawing save while conversion is pending', () => {
  it('keeps a file attached meanwhile and replaces the edited original', async () => {
    const original = image('original.png', 1);
    const added = image('added.png', 1);
    const edited = image('edited.png', 1);
    const { result, finish } = await startDrawingSave([original], 0);

    act(() => result.current.setFiles((current) => [...current, added]));
    await finish(edited);

    expect(names(result.current.files)).toEqual(['edited.png', 'added.png']);
  });

  it('replaces the original at its new index after an earlier file is removed', async () => {
    const earlier = image('earlier.png', 1);
    const original = image('original.png', 1);
    const later = image('later.png', 1);
    const edited = image('edited.png', 1);
    const { result, finish } = await startDrawingSave([earlier, original, later], 1);

    act(() => result.current.operations.handleRemoveFile(0));
    await finish(edited);

    expect(names(result.current.files)).toEqual(['edited.png', 'later.png']);
  });

  it('skips the edit when the original was removed meanwhile', async () => {
    const kept = image('kept.png', 1);
    const original = image('original.png', 1);
    const { result, finish } = await startDrawingSave([kept, original], 1);

    act(() => result.current.operations.handleRemoveFile(1));
    await finish(image('edited.png', 1));

    expect(names(result.current.files)).toEqual(['kept.png']);
  });
});

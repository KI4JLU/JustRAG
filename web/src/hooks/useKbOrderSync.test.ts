import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import axios from 'axios';
import { kbOrderKey, resetKbOrderSession, useKbOrder } from './useKbOrder';

/* The account-backed order: one load per user, saves one at a time, the
 * one-time upload of the order the browser kept before. Oracle: the route
 * contract in API.md (GET → {my, shared}, null = never saved; PUT
 * /api/kb-user-order/{view} with {ids}) and the order the test itself drags. */

vi.mock('axios');
const mockedAxios = vi.mocked(axios, true);

const auth = vi.hoisted(() => ({ userId: 'user-1' }));
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: auth.userId } }),
}));
vi.mock('../contexts/ThemeContext', () => ({
  useTheme: () => ({ t: (key: string) => key }),
}));
const toastError = vi.fn();
const toast = { error: toastError, success: vi.fn(), info: vi.fn(), warning: vi.fn() };
vi.mock('../contexts/ToastContext', () => ({
  useToast: () => toast,
}));

// jsdom's localStorage is unreliable on Node 25; a real in-memory Storage.
function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() { return data.size; },
    clear: () => data.clear(),
    getItem: (k: string) => data.get(k) ?? null,
    key: (i: number) => [...data.keys()][i] ?? null,
    removeItem: (k: string) => { data.delete(k); },
    setItem: (k: string, v: string) => { data.set(k, String(v)); },
  } as Storage;
}

const kbs = (...ids: string[]) => ids.map(id => ({ id }));
const shown = (order: ReturnType<typeof useKbOrder>, ...ids: string[]) => order.apply(kbs(...ids)).map(kb => kb.id);
const putCalls = () => mockedAxios.put.mock.calls.map(([url, body]) => [url, (body as { ids: string[] }).ids]);

function deferred() {
  let resolve!: () => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

// AppRoot keeps the sign-in's token on axios's defaults.
const signIn = (token: string) => Object.assign(mockedAxios, { defaults: { headers: { common: { Authorization: `Bearer ${token}` } } } });

beforeEach(() => {
  resetKbOrderSession();
  auth.userId = 'user-1';
  signIn('one');
  vi.stubGlobal('localStorage', memoryStorage());
  mockedAxios.get.mockReset();
  mockedAxios.put.mockReset();
  mockedAxios.put.mockResolvedValue({ status: 204 });
  toastError.mockReset();
});

describe('useKbOrder with the account', () => {
  it('sorts by the saved order, loaded once for both views', async () => {
    mockedAxios.get.mockResolvedValue({ data: { my: ['c', 'a'], shared: ['y', 'x'] } });
    const my = renderHook(() => useKbOrder('my'));
    const shared = renderHook(() => useKbOrder('shared'));

    await waitFor(() => expect(shown(my.result.current, 'a', 'b', 'c')).toEqual(['b', 'c', 'a']));
    await waitFor(() => expect(shown(shared.result.current, 'x', 'y')).toEqual(['y', 'x']));
    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
    expect(mockedAxios.get.mock.calls[0][0]).toMatch(/\/api\/kb-user-order$/);
    expect(mockedAxios.put).not.toHaveBeenCalled();
  });

  it('saves a drag as the whole order of its view', async () => {
    mockedAxios.get.mockResolvedValue({ data: { my: null, shared: null } });
    const { result } = renderHook(() => useKbOrder('my'));
    await waitFor(() => expect(mockedAxios.get).toHaveBeenCalled());

    act(() => result.current.move(['a', 'b', 'c'], 'c', 'a'));

    expect(shown(result.current, 'a', 'b', 'c')).toEqual(['c', 'a', 'b']);
    await waitFor(() => expect(putCalls()).toEqual([[expect.stringMatching(/\/api\/kb-user-order\/my$/), ['c', 'a', 'b']]]));
  });

  it('shows the latest drag when a view mounts again', async () => {
    mockedAxios.get.mockResolvedValue({ data: { my: ['a', 'b'], shared: null } });
    const first = renderHook(() => useKbOrder('my'));
    await waitFor(() => expect(shown(first.result.current, 'a', 'b')).toEqual(['a', 'b']));
    act(() => first.result.current.set(['b', 'a']));
    first.unmount();

    const again = renderHook(() => useKbOrder('my'));
    await waitFor(() => expect(shown(again.result.current, 'a', 'b')).toEqual(['b', 'a']));
    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
  });

  it('sends saves one at a time, and only the newest waiting one', async () => {
    mockedAxios.get.mockResolvedValue({ data: { my: null, shared: null } });
    const first = deferred();
    mockedAxios.put.mockReturnValueOnce(first.promise as never);
    const { result } = renderHook(() => useKbOrder('my'));
    await waitFor(() => expect(mockedAxios.get).toHaveBeenCalled());

    act(() => result.current.set(['a', 'b', 'c']));
    act(() => result.current.set(['b', 'a', 'c']));
    act(() => result.current.set(['c', 'b', 'a']));
    expect(putCalls().map(([, ids]) => ids)).toEqual([['a', 'b', 'c']]);

    await act(async () => { first.resolve(); await first.promise; });
    await waitFor(() => expect(putCalls().map(([, ids]) => ids)).toEqual([['a', 'b', 'c'], ['c', 'b', 'a']]));
  });

  it('keeps the dragged order and says so when a save fails', async () => {
    mockedAxios.get.mockResolvedValue({ data: { my: null, shared: null } });
    mockedAxios.put.mockRejectedValueOnce(new Error('offline'));
    const { result } = renderHook(() => useKbOrder('my'));
    await waitFor(() => expect(mockedAxios.get).toHaveBeenCalled());

    act(() => result.current.set(['b', 'a']));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('topicOrderSaveError'));
    expect(shown(result.current, 'a', 'b')).toEqual(['b', 'a']);
  });

  it('lets a drag made before the load win over the loaded order', async () => {
    const load = deferred();
    mockedAxios.get.mockReturnValueOnce(load.promise.then(() => ({ data: { my: ['a', 'b'], shared: null } })) as never);
    const { result } = renderHook(() => useKbOrder('my'));

    act(() => result.current.set(['b', 'a']));
    await act(async () => { load.resolve(); await load.promise; });

    await waitFor(() => expect(putCalls().length).toBe(1));
    expect(shown(result.current, 'a', 'b')).toEqual(['b', 'a']);
  });
});

describe('useKbOrder across sign-ins', () => {
  it('sends a save with its own sign-in and drops what waits once that sign-in ends', async () => {
    mockedAxios.get.mockResolvedValue({ data: { my: null, shared: null } });
    const first = deferred();
    mockedAxios.put.mockReturnValueOnce(first.promise as never);
    const { result } = renderHook(() => useKbOrder('my'));
    await waitFor(() => expect(mockedAxios.get).toHaveBeenCalled());

    act(() => result.current.set(['a', 'b']));
    act(() => result.current.set(['b', 'a']));
    expect(mockedAxios.put.mock.calls[0][2]).toEqual({ headers: { Authorization: 'Bearer one' } });

    signIn('two');
    await act(async () => { first.resolve(); await first.promise; });
    await act(async () => {});
    expect(mockedAxios.put).toHaveBeenCalledTimes(1);
  });

  it('loads again for a new sign-in of the same user', async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: { my: ['a', 'b'], shared: null } });
    const first = renderHook(() => useKbOrder('my'));
    await waitFor(() => expect(shown(first.result.current, 'a', 'b')).toEqual(['a', 'b']));
    act(() => first.result.current.set(['b', 'a']));
    first.unmount();

    signIn('two');
    mockedAxios.get.mockResolvedValueOnce({ data: { my: ['a', 'b'], shared: null } });
    const again = renderHook(() => useKbOrder('my'));
    await waitFor(() => expect(mockedAxios.get).toHaveBeenCalledTimes(2));
    await act(async () => {});
    expect(shown(again.result.current, 'a', 'b')).toEqual(['a', 'b']);
    expect(mockedAxios.get.mock.calls[1][1]).toEqual({ headers: { Authorization: 'Bearer two' } });
  });
});

describe('useKbOrder moving the browser order to the account', () => {
  it('uploads the order the browser kept when the account has none, then forgets it', async () => {
    localStorage.setItem(kbOrderKey('my'), JSON.stringify(['b', 'a']));
    mockedAxios.get.mockResolvedValue({ data: { my: null, shared: null } });
    const { result } = renderHook(() => useKbOrder('my'));

    await waitFor(() => expect(shown(result.current, 'a', 'b')).toEqual(['b', 'a']));
    await waitFor(() => expect(putCalls()).toEqual([[expect.stringMatching(/\/my$/), ['b', 'a']]]));
    await waitFor(() => expect(localStorage.getItem(kbOrderKey('my'))).toBeNull());
  });

  it('prefers the account order and forgets the browser one', async () => {
    localStorage.setItem(kbOrderKey('shared'), JSON.stringify(['x', 'y']));
    mockedAxios.get.mockResolvedValue({ data: { my: null, shared: ['y', 'x'] } });
    const { result } = renderHook(() => useKbOrder('shared'));

    await waitFor(() => expect(shown(result.current, 'x', 'y')).toEqual(['y', 'x']));
    expect(localStorage.getItem(kbOrderKey('shared'))).toBeNull();
    expect(mockedAxios.put).not.toHaveBeenCalled();
  });

  it('treats a saved empty order as saved, not as missing', async () => {
    localStorage.setItem(kbOrderKey('my'), JSON.stringify(['b', 'a']));
    mockedAxios.get.mockResolvedValue({ data: { my: [], shared: null } });
    const { result } = renderHook(() => useKbOrder('my'));

    await waitFor(() => expect(localStorage.getItem(kbOrderKey('my'))).toBeNull());
    expect(shown(result.current, 'a', 'b')).toEqual(['a', 'b']);
    expect(mockedAxios.put).not.toHaveBeenCalled();
  });

  it('uploads nothing when the load fails, and loads again on the next mount', async () => {
    localStorage.setItem(kbOrderKey('my'), JSON.stringify(['b', 'a']));
    mockedAxios.get.mockRejectedValueOnce(new Error('500'));
    const first = renderHook(() => useKbOrder('my'));
    await waitFor(() => expect(mockedAxios.get).toHaveBeenCalledTimes(1));
    await act(async () => {});
    expect(shown(first.result.current, 'a', 'b')).toEqual(['a', 'b']);
    expect(mockedAxios.put).not.toHaveBeenCalled();
    expect(localStorage.getItem(kbOrderKey('my'))).not.toBeNull();
    first.unmount();

    mockedAxios.get.mockResolvedValueOnce({ data: { my: ['b', 'a'], shared: null } });
    const again = renderHook(() => useKbOrder('my'));
    await waitFor(() => expect(shown(again.result.current, 'a', 'b')).toEqual(['b', 'a']));
    expect(mockedAxios.get).toHaveBeenCalledTimes(2);
  });

  it('settles both browser keys at the first load, whichever view mounts', async () => {
    localStorage.setItem(kbOrderKey('my'), JSON.stringify(['b', 'a']));
    localStorage.setItem(kbOrderKey('shared'), JSON.stringify(['y', 'x']));
    mockedAxios.get.mockResolvedValue({ data: { my: ['a', 'b'], shared: null } });
    renderHook(() => useKbOrder('my'));

    await waitFor(() => expect(putCalls()).toEqual([[expect.stringMatching(/\/shared$/), ['y', 'x']]]));
    await waitFor(() => expect(localStorage.getItem(kbOrderKey('shared'))).toBeNull());
    expect(localStorage.getItem(kbOrderKey('my'))).toBeNull();
  });

  it('tries a failed upload again when a view mounts again', async () => {
    localStorage.setItem(kbOrderKey('my'), JSON.stringify(['b', 'a']));
    mockedAxios.get.mockResolvedValue({ data: { my: null, shared: null } });
    mockedAxios.put.mockRejectedValueOnce(new Error('offline'));
    const first = renderHook(() => useKbOrder('my'));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('topicOrderSaveError'));
    expect(localStorage.getItem(kbOrderKey('my'))).not.toBeNull();
    first.unmount();

    const again = renderHook(() => useKbOrder('my'));
    await waitFor(() => expect(mockedAxios.put).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(localStorage.getItem(kbOrderKey('my'))).toBeNull());
    expect(mockedAxios.get).toHaveBeenCalledTimes(2);
    expect(shown(again.result.current, 'a', 'b')).toEqual(['b', 'a']);
  });

  it('drops an order another user claimed instead of uploading it', async () => {
    localStorage.setItem(kbOrderKey('my'), JSON.stringify({ owner: 'user-0', ids: ['b', 'a'] }));
    mockedAxios.get.mockResolvedValue({ data: { my: null, shared: null } });
    const { result } = renderHook(() => useKbOrder('my'));

    await waitFor(() => expect(localStorage.getItem(kbOrderKey('my'))).toBeNull());
    expect(mockedAxios.put).not.toHaveBeenCalled();
    expect(shown(result.current, 'a', 'b')).toEqual(['a', 'b']);
  });

  it('marks a failed upload with its owner', async () => {
    localStorage.setItem(kbOrderKey('my'), JSON.stringify(['b', 'a']));
    mockedAxios.get.mockResolvedValue({ data: { my: null, shared: null } });
    mockedAxios.put.mockRejectedValueOnce(new Error('offline'));
    renderHook(() => useKbOrder('my'));

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(JSON.parse(localStorage.getItem(kbOrderKey('my'))!)).toEqual({ owner: 'user-1', ids: ['b', 'a'] });
  });

  it('keeps the claim of the user signed in now when an old save finishes', async () => {
    mockedAxios.get.mockResolvedValue({ data: { my: null, shared: null } });
    const oldSave = deferred();
    mockedAxios.put.mockReturnValueOnce(oldSave.promise as never);
    mockedAxios.put.mockRejectedValueOnce(new Error('offline'));
    const first = renderHook(() => useKbOrder('my'));
    await waitFor(() => expect(mockedAxios.get).toHaveBeenCalledTimes(1));
    act(() => first.result.current.set(['a']));
    first.unmount();

    // Another user signs in on this browser; their upload of the old key fails.
    auth.userId = 'user-2';
    signIn('two');
    localStorage.setItem(kbOrderKey('my'), JSON.stringify(['b', 'a']));
    renderHook(() => useKbOrder('my'));
    await waitFor(() => expect(toastError).toHaveBeenCalled());

    await act(async () => { oldSave.resolve(); await oldSave.promise; });
    expect(JSON.parse(localStorage.getItem(kbOrderKey('my'))!)).toEqual({ owner: 'user-2', ids: ['b', 'a'] });
  });

  it('drops the browser order when a drag beats the load, even if that save fails', async () => {
    localStorage.setItem(kbOrderKey('my'), JSON.stringify(['b', 'a']));
    const load = deferred();
    mockedAxios.get.mockReturnValueOnce(load.promise.then(() => ({ data: { my: null, shared: null } })) as never);
    mockedAxios.put.mockRejectedValueOnce(new Error('offline'));
    const { result } = renderHook(() => useKbOrder('my'));

    act(() => result.current.set(['a', 'b']));
    await act(async () => { load.resolve(); await load.promise; });

    await waitFor(() => expect(localStorage.getItem(kbOrderKey('my'))).toBeNull());
    expect(putCalls().map(([, ids]) => ids)).toEqual([['a', 'b']]);
    expect(shown(result.current, 'a', 'b')).toEqual(['a', 'b']);
  });
});

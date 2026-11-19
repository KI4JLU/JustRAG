import { describe, expect, it, vi } from 'vitest';
import { applyWaitingUpdate } from './applyWaitingUpdate';

type Container = NonNullable<Parameters<typeof applyWaitingUpdate>[0]>;

/** A service-worker container whose waiting worker takes over when told to, or never. */
function container(opts: { controlled?: boolean; waiting?: boolean; takesOver?: boolean; fails?: boolean }) {
    let onChange: (() => void) | undefined;
    const postMessage = vi.fn(() => {
        if (opts.takesOver) queueMicrotask(() => onChange?.());
    });
    const sw = {
        controller: opts.controlled === false ? null : ({} as ServiceWorker),
        getRegistration: async () => {
            if (opts.fails) throw new Error('blocked');
            return { waiting: opts.waiting ? { postMessage } : null } as unknown as ServiceWorkerRegistration;
        },
        addEventListener: (_type: string, listener: () => void) => { onChange = listener; },
    } as unknown as Container;
    return { sw, postMessage, takeOver: () => onChange?.() };
}

describe('applyWaitingUpdate', () => {
    it('activates a waiting worker and reloads once it controls the page', async () => {
        const { sw, postMessage } = container({ waiting: true, takesOver: true });
        const reload = vi.fn();
        await expect(applyWaitingUpdate(sw, reload)).resolves.toBe(true);
        expect(postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
        expect(reload).toHaveBeenCalledTimes(1);
    });

    it('does nothing when no worker is waiting', async () => {
        const { sw, postMessage } = container({ waiting: false });
        const reload = vi.fn();
        await expect(applyWaitingUpdate(sw, reload)).resolves.toBe(false);
        expect(postMessage).not.toHaveBeenCalled();
        expect(reload).not.toHaveBeenCalled();
    });

    it('does nothing on a page no worker controls', async () => {
        const { sw, postMessage } = container({ controlled: false, waiting: true, takesOver: true });
        await expect(applyWaitingUpdate(sw, vi.fn())).resolves.toBe(false);
        expect(postMessage).not.toHaveBeenCalled();
    });

    it('starts the app when the worker does not take over in time', async () => {
        const { sw } = container({ waiting: true, takesOver: false });
        const reload = vi.fn();
        await expect(applyWaitingUpdate(sw, reload, 10)).resolves.toBe(false);
        expect(reload).not.toHaveBeenCalled();
    });

    it('reloads when the worker takes over after the app has started', async () => {
        const { sw, takeOver } = container({ waiting: true, takesOver: false });
        const reload = vi.fn();
        await expect(applyWaitingUpdate(sw, reload, 10)).resolves.toBe(false);
        takeOver();
        expect(reload).toHaveBeenCalledTimes(1);
    });

    it('starts the app without service worker support or when the lookup fails', async () => {
        await expect(applyWaitingUpdate(undefined, vi.fn())).resolves.toBe(false);
        await expect(applyWaitingUpdate(container({ fails: true }).sw, vi.fn())).resolves.toBe(false);
    });
});

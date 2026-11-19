/**
 * Applies an app update that is already waiting when the page loads.
 *
 * A newly deployed service worker waits while a tab of the previous build is
 * open, and that tab keeps getting the previous app shell — on every reload,
 * too, since the reloading tab is the one keeping the worker waiting. A page
 * load is the one moment a version change costs the user nothing: there is no
 * draft and no running answer yet. So before the app renders, a worker found
 * waiting is told to take over, and the page reloads once it has.
 *
 * Resolves true when that reload is on its way (the caller does not render),
 * false when there is nothing to apply or the worker did not take over in
 * time — the app then starts on the build it has. A takeover that comes
 * after that still reloads the page: the worker was already told to take
 * over, and a page of the previous build cannot run under it, as its
 * lazily loaded files are gone from the worker's store.
 */
export async function applyWaitingUpdate(
    sw: Pick<ServiceWorkerContainer, 'controller' | 'getRegistration' | 'addEventListener'> | undefined =
        typeof navigator !== 'undefined' ? navigator.serviceWorker : undefined,
    reload: () => void = () => window.location.reload(),
    timeoutMs = 3000,
): Promise<boolean> {
    // No controller: this page came from the network, not from a worker's
    // stored shell, so it is current already.
    if (!sw || !sw.controller) return false;
    try {
        const waiting = (await sw.getRegistration())?.waiting;
        if (!waiting) return false;
        return await new Promise<boolean>((resolve) => {
            const timer = setTimeout(() => resolve(false), timeoutMs);
            // Stays after the timeout on purpose, see above.
            sw.addEventListener('controllerchange', () => {
                clearTimeout(timer);
                reload();
                resolve(true);
            }, { once: true });
            // The message the generated worker listens for (vite-plugin-pwa).
            waiting.postMessage({ type: 'SKIP_WAITING' });
        });
    } catch {
        return false;
    }
}

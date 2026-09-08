import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

afterEach(() => {
  cleanup();
});

// jsdom declares the ResizeObserver *type* but ships no runtime implementation.
// Anything that measures a DOM box needs it — most visibly @xyflow/react, whose
// internal node-measuring hook constructs one unconditionally. Three suites used
// to carry a byte-identical local copy of this class; it belongs here next to
// the framer-motion stub, so a new suite that renders a canvas doesn't have to
// rediscover the gap.
class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= NoopResizeObserver as unknown as typeof ResizeObserver;

// Mock framer-motion to avoid jsdom issues with animations
vi.mock('framer-motion', async () => {
  const { forwardRef, createElement } = await vi.importActual<typeof import('react')>('react');

  // framer-motion-specific props that must be stripped before rendering the
  // plain HTML element, so they don't leak onto the DOM node.
  const MOTION_PROPS = [
    'initial', 'animate', 'exit', 'transition', 'variants',
    'whileHover', 'whileTap', 'whileFocus', 'whileDrag', 'whileInView',
    'layout', 'layoutId',
  ];

  // One component per tag, created once. React identifies elements by their
  // type, so handing back a fresh forwardRef on every property access makes
  // every `motion.div` in a re-render a *different* type — React then unmounts
  // the old subtree and mounts a new one on each render. Anything holding a DOM
  // node across a state update (an element a test just queried, a focused
  // input, scroll position) silently loses it, which surfaced as a CI-only
  // "element could not be found in the document" in Login.test.tsx.
  const componentsByTag = new Map<string | symbol, unknown>();

  /** Strips the animation-only props so they never reach a DOM node. */
  const stripMotionProps = (props: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(props).filter(([k]) => !MOTION_PROPS.includes(k)));

  /**
   * `createElement`, retyped to accept a `ref` in the props bag.
   * @types/react's `Attributes` still carries only `key`, so the component
   * overload rejects `ref` even though React 19 treats it as an ordinary prop.
   * The tag overload accepts it, which is why only the component factory below
   * needs this.
   */
  const createElementWithRef = createElement as unknown as (
    type: unknown,
    props: Record<string, unknown>,
  ) => ReturnType<typeof createElement>;

  return {
    motion: new Proxy({}, {
      get: (_target, prop: string) => {
        // `motion.create(Component)` is framer-motion's factory for animating
        // a third-party component (SystemHealthDashboard.tsx animates the
        // design system's `Card` with it, card KI-714). It is a FUNCTION, not
        // a tag name, so the tag branch below would hand back a forwardRef
        // object and calling it throws at module load. Under test the
        // animation is a no-op, so the factory returns the wrapped component
        // with the motion props removed — same contract as the tag branch.
        if (prop === 'create') {
          return (Component: unknown) => {
            const Animated = forwardRef((props: Record<string, unknown>, ref: unknown) =>
              createElementWithRef(Component, { ...stripMotionProps(props), ref }),
            );
            Animated.displayName = 'motion.create()';
            return Animated;
          };
        }

        const cached = componentsByTag.get(prop);
        if (cached) return cached;

        // A forwardRef component that renders the plain HTML element.
        const Component = forwardRef((props: Record<string, unknown>, ref: unknown) =>
          createElement(prop, { ...stripMotionProps(props), ref }),
        );
        Component.displayName = `motion.${String(prop)}`;
        componentsByTag.set(prop, Component);
        return Component;
      },
    }),
    AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
  };
});

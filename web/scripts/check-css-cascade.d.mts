/* Hand-written declarations for check-css-cascade.mjs.
 *
 * The checker is plain ESM rather than TypeScript because `npm run build` runs
 * it with bare `node` (CI pins Node 20, which cannot strip types), while the
 * unit test in src/test/ needs to import the same function — one
 * implementation, two entry points, so this file is the seam. */
export interface ShadowedUtility {
  /** The colliding selector, exactly as written in the stylesheet. */
  selector: string;
  /** The at-rule context of the UNLAYERED rule, or `'(unconditional)'`. */
  condition: string;
}

export function findShadowedUtilities(css: string, layerName?: string): ShadowedUtility[];

export function checkFiles(files: string[]): number;

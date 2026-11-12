// Sample parts for the automated feature checks. Each feature folder has a samples.ts that builds
// small parts with Manifold, so the repository needs no third-party STL files.
import type { Manifold, ManifoldToplevel } from 'manifold-3d';

export interface Sample {
  name: string;
  build(w: ManifoldToplevel): Manifold;
  /**
   * What applying the feature to every target must achieve, beyond changing the part:
   * fewer overhangs, less area on the bed, or (for features that reshape a ceiling) nothing more.
   */
  expect: 'fewer-overhangs' | 'smaller-bed-contact' | 'changed';
  /** Minimum number of targets the feature must find. */
  targets: number;
}

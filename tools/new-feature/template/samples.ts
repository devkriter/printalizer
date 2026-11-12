import type { Sample } from '../samples.ts';

// Small parts built with Manifold that show what the feature is for. The automated checks apply the
// feature to every target on each sample and check the result.
export const samples: Sample[] = [
  {
    name: 'block with a hole',
    targets: 1,
    expect: 'changed',
    build: ({ Manifold }) => Manifold.cube([20, 20, 10]).subtract(Manifold.cylinder(20, 3, 3, 48).translate([10, 10, -1])),
  },
];

import type { Sample } from '../samples.ts';

export const samples: Sample[] = [
  {
    name: 'block with a hole through it',
    targets: 1,
    expect: 'smaller-bed-contact',
    build: ({ Manifold }) => Manifold.cube([30, 20, 8]).subtract(Manifold.cylinder(20, 4, 4, 48).translate([15, 10, -1])),
  },
];

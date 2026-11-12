import type { Sample } from '../samples.ts';

export const samples: Sample[] = [
  {
    name: 'block with a counterbore facing the bed',
    targets: 1,
    expect: 'changed',
    build: ({ Manifold }) => Manifold.cube([24, 24, 10])
      .subtract(Manifold.cylinder(4, 5, 5, 64).translate([12, 12, -0.5]).add(Manifold.cylinder(4.5, 5, 5, 64).translate([12, 12, -1])))
      .subtract(Manifold.cylinder(20, 2.75, 2.75, 48).translate([12, 12, -1])),
  },
];

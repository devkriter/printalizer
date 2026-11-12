import type { Sample } from '../samples.ts';

export const samples: Sample[] = [
  {
    name: 'wall with a ledge sticking out',
    targets: 1,
    expect: 'fewer-overhangs',
    build: ({ Manifold }) => Manifold.cube([10, 20, 20]).add(Manifold.cube([10, 20, 4]).translate([10, 0, 14])),
  },
];

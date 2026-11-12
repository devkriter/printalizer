import type { Sample } from '../samples.ts';

export const samples: Sample[] = [
  {
    name: 'plate with three horizontal holes',
    targets: 3,
    expect: 'fewer-overhangs',
    build: ({ Manifold }) => {
      let m = Manifold.cube([50, 10, 20]);
      for (const [x, r] of [[10, 1.6], [25, 3], [40, 5]] as const) m = m.subtract(Manifold.cylinder(12, r, r, 48, true).rotate([90, 0, 0]).translate([x, 5, 10]));
      return m;
    },
  },
];

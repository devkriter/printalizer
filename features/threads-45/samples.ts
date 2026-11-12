import type { Sample } from '../samples.ts';
import { threadOutline } from '../../core/threads.ts';

const SEG = 72;

export const samples: Sample[] = [
  {
    name: 'M8 nut standing on the bed',
    targets: 1,
    expect: 'fewer-overhangs',
    build: ({ CrossSection, Manifold }) => {
      // Only the threaded hole twists; the nut's outside stays straight.
      const hole = new CrossSection([threadOutline('internal', 4, 1.25, 30, 1.25 / 8, SEG)]).extrude(8, Math.ceil((8 / 1.25) * SEG), (360 * 8) / 1.25);
      return Manifold.cube([16, 16, 8], true).translate([0, 0, 4]).subtract(hole);
    },
  },
  {
    name: 'M10 bolt standing on its head',
    targets: 1,
    expect: 'fewer-overhangs',
    build: ({ CrossSection, Manifold }) => {
      const rod = new CrossSection([threadOutline('external', 5, 1.5, 30, 1.5 / 8, SEG)]).extrude(12, Math.ceil((12 / 1.5) * SEG), (360 * 12) / 1.5);
      return Manifold.cylinder(5, 9, 9, 6).add(rod.translate([0, 0, 5]));
    },
  },
];

# Contributing

Thanks for helping. The most useful contribution is a new feature: something that finds a shape that prints badly and rewrites it.

## Set up

```bash
npm install
npm run dev     # the app on http://localhost:8793
npm test        # core tests and the automated feature checks
```

## Add a feature

1. Run `npm run new-feature -- your-feature`.
2. Fill in `features/your-feature/index.ts`, `samples.ts` and `README.md`. [features/README.md](features/README.md) explains the format and what `ctx` offers.
3. Run `npm test`. The automated checks run your feature on its samples, and the result must be a valid closed solid that does what the sample claims.
4. Open a pull request. Change no files outside your folder, because the app finds the folder by itself.

Ideas that fit well:
- thread-forming ribs for self-tapping screws,
- heat-set insert pockets,
- seam notches for vertical holes,
- crush ribs for press fits.

## Code

- **Stack:** TypeScript, React for panels, plain three.js for the 3D view. Manifold does all cutting, in a worker.
- **Core code** goes in `core/`, with tests next to it. It must not import from `app/`.
- **Features** never edit meshes. They return plain-data solids, and the app does the cutting.
- **Wording:** direct and short, counting only what the user did.

## Licence

Printalizer is licensed AGPL-3.0-or-later. By contributing you agree your work is released under the same licence.

Code from projects under licences compatible with it may be included, as long as their copyright and licence notices are kept with the code and the source is named in the pull request. Compatible licences include:
- AGPL-3.0 and GPL-3.0 (for example OrcaSlicer and PrusaSlicer),
- LGPL-3.0,
- MIT, BSD and Apache-2.0.

GPL-2.0-only code is not compatible.

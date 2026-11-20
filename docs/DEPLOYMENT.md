# Deploy Abyss Weaver

The static archive contains a production Vite build. It includes the game,
branding, fonts and license notices. The source checkout can build the same
layout with `npm ci` followed by `npm run build`.

## Host the static build

Serve every file from the static archive over HTTPS. Its asset paths are
relative and work from a site root or a directory such as
`/projects/abyss-weaver/play/`. Keep the `assets/` and `licenses/` directories
alongside `index.html`. No backend, database, or rewrite is required.

For GitHub Pages, upload the contents of `dist/` as a Pages artifact or
select a published branch with those contents at its root. Enable Pages once
the destination is approved. A project site can use the default repository
subpath. The source CI builds and tests the game without publishing a Pages site.

The Dorothy portfolio listing links to the existing playable game at
`https://dorothy.gr/games/abyssweaver/`. Keep the existing production folder
until a replacement of that game is approved.

## Post-deploy checks

1. Open the exact public path, including its trailing slash. The menu and
   Dorothy wordmark should load without missing assets.
2. Start the campaign and draw a loop around a creature. Check the score,
   pause and resume controls, and audio volume.
3. Try touch steering on a phone in portrait and landscape.
4. Reload and verify settings persist. The release's reset control clears
   only this game's current settings and records.
5. Open the public game with `?debug` and check that the test interface
   remains unavailable. Keep the license files in the published artifact.

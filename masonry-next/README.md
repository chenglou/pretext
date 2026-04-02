# Pretext Masonry Next

This is a local Next.js recreation of the Pretext masonry demo, backed by SQLite.

## Run

```sh
cd /Users/shyam.suthar/Documents/personal-github/pretext-worklog/masonry-next
./node_modules/.bin/next dev -p 3001
```

Open `http://127.0.0.1:3001`.

Keyboard shortcuts:
- `Cmd/Ctrl +` zoom in
- `Cmd/Ctrl -` zoom out
- `Cmd/Ctrl 0` reset zoom

## Build

```sh
cd /Users/shyam.suthar/Documents/personal-github/pretext-worklog/masonry-next
./node_modules/.bin/next build
./node_modules/.bin/next start -p 3001
```

## Verify

```sh
cd /Users/shyam.suthar/Documents/personal-github/pretext-worklog/masonry-next
npm run verify
```

This runs an isolated production build in `.next-e2e` plus the Playwright end-to-end suite. That is the command to use before calling a change fixed.

## Data

- Seed content: `data/shower-thoughts.json`
- SQLite database: `data/masonry.sqlite`

On this machine, `node_modules` is a symlink to `/Users/shyam.suthar/node_modules` because npm registry access is currently unreliable. When registry access is available, you can replace that with a normal local install.

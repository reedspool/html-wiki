# HTML Wiki

Wiki server and static site generator in Node. Novel HTML-based page generation.

## About

An experimental wiki server and static site generator. Uses a novel HTML-based page generation scheme.

"Work In Progress" and "Under Construction" are understatements in this case. I barely have any idea what I'm doing here, but this project is in active use as both a personal wiki / second-brain / zettelkasten solution and a static site generator for my personal site.

## Tasks

These are the development script snippets.

[![xc compatible](https://xcfile.dev/badge.svg)](https://xcfile.dev)

You can run these scripts easily with [`xc`](https://xcfile.dev), or just copy
them to your terminal. Some lines below like `interactive: true` are for `xc`.

### install

Basic dev environment setup. Requires `node`, only tested on >v24. Clone this repo then run:

```sh
npm install
```

### generate:documentation

Generate a static site from the contents of the `entries/documentation/` directory (and implicitly the `entries/core` directory).

```sh
DEBUG=* node server/cli.mts generate --user-directory entries/documentation -o ./build
```

### generate:test

Generate a static site from the contents of the `entries/test/` directory (and implicitly the `entries/core` directory).

```sh
DEBUG=* node server/cli.mts generate --user-directory entries/test -o ./build
```

### fix:css

Fix up CSS via `stylelint` configured in `.stylelintrc.json`.

```sh
stylelint --fix entries/system/global.css
```

### serve:documentation

Start a server with the contents of the `entries/documentation/` directory (and implicitly the `entries/core` directory).

```sh
DEBUG=* node server/cli.mts server --port 3001 -u entries/documentation
```

### serve:test

Start a server with the contents of the `entries/test/` directory (and implicitly the `entries/core` directory).

```sh
DEBUG=* node server/cli.mts server --port 3001 -u entries/test
```

### test

Run the `node` test suite. Requires the `serve:test` task to be running.

```sh
DEBUG=* node --test
```

### test:watch

Same as above but in watch mode.

```sh
cd server && node --test --watch"
```

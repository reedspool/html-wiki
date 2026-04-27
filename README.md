# HTML Wiki

Wiki server and static site generator in Node. Novel HTML-based page generation.

## About

An experimental wiki server and static site generator. Uses a novel HTML-based page generation scheme.

To call this a "Work In Progress" or "Under Construction" would be an understatement. I barely have any idea what I'm doing here, though I do use this actively as both a personal wiki / second-brain / zettelkasten solution and a static site generator for my personal site.

## Installation

Requires Node (only tested >=v25). To use the script globally, use `npm install -g`:

```sh
npm install -g @reedspool/html-wiki
```

You can also install it as a dependency of a project, from the project directory:

```sh
npm install @reedspool/html-wiki
```

## Usage

First off, I may have forgotten to update this, or I was too lazy to make it complete, so you can get help:

```sh
npx html-wiki --help
```

There are two major modes of use: `generate` and `server`. Note that `DEBUG=*` env variable makes the command very loud.

With `generate`, the tool writes a directory of HTML files.

```sh
DEBUG=* npx html-wiki generate --user-directory ./custom-website -o ./build
```

With `server`, it starts up a live web server:

```sh
DEBUG=* npx html-wiki server --port 3001  --user-directory ./custom-website -o ./build
```

You can also get help for the options specific to each command:

```sh
npx html-wiki generate --help
npx html-wiki server --help
```

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
rm -rf ./build && mkdir ./build
DEBUG=* node ./server/cli.mts generate --user-directory entries/documentation -o ./build
```

### generate:test

Generate a static site from the contents of the `entries/test/` directory (and implicitly the `entries/core` directory).

```sh
rm -rf ./build && mkdir ./build
DEBUG=* node ./server/cli.mts generate --user-directory entries/test -o ./build
```

### fix:css

Fix up CSS via `stylelint` configured in `.stylelintrc.json`.

```sh
stylelint --fix entries/system/global.css
```

### serve:documentation

Start a server with the contents of the `entries/documentation/` directory (and implicitly the `entries/core` directory).

```sh
DEBUG=* node ./server/cli.mts server --port 3001 -u entries/documentation
```

### serve:test

Start a server with the contents of the `entries/test/` directory (and implicitly the `entries/core` directory).

```sh
DEBUG=* node ./server/cli.mts server --port 3001 -u entries/test
```

### test

Run the `node` test suite. Requires the `serve:test` task to be running.

```sh
DEBUG=* node --test
```

### test:watch

Same as above but in watch mode.

```sh
cd server && node --test --watch
```

### publish

Publish to `npm`. Will fail if `git status` isn't clean, so commit before you publish. Will also create a commit.

```sh
npm version patch
npm publish
```

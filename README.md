# HTML Wiki

Experiment with a custom wiki where entries are written and stored as HTML files on disk.

## Running locally

Without Docker

```sh
npm run start
```

Build with Docker. This will print out a long image ID

```sh
docker build .
```

Then you can use that ID to run:

```sh
docker run -p 3001:3001 <image-id>
```

## Deploy

You'll need to install `flyctl` which you should check the Fly.io docs for, but last it was:

```sh
curl -L https://fly.io/install.sh | sh
```

then you can (with proper auth)

```sh
fly deploy
```

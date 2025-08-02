// Catch and snuff all uncaught exceptions and uncaught promise rejections.
// We can manually restart the server if it gets into a bad state, but we want

import { createServer } from "./server.mts";
import { Command } from "@commander-js/extra-typings";

let server: ReturnType<typeof createServer>;

// So I can kill from local terminal with Ctrl-c
// From https://github.com/strongloop/node-foreman/issues/118#issuecomment-475902308
process.on("SIGINT", (signal) => {
    console.log(`Signal ${signal} received, shutting down`);
    server.cleanup();
    // Just wait some amount of time before exiting. Ideally the listener would
    // close successfully, but it seems to hang for some reason.
    setTimeout(() => process.exit(0), 150);
});

const program = new Command()
    .option("--port <number>")
    .option("--ignore-errors");
program.parse();
const options = program.opts();

let port: number;
if (process.env.PORT !== undefined) {
    port = Number(process.env.PORT);
    console.log(`Using environment variable port ${port}`);
} else if (options.port !== undefined) {
    port = Number(options.port);
    console.log(`Using command line option port ${port}`);
} else {
    port = 3001;
    console.log(`Using default port ${port}`);
}

if (options.ignoreErrors) {
    // to preserve the weirdness for as long as possible.
    process.on("uncaughtException", function (err) {
        console.error("Top-level uncaught exception: " + err, err);
    });
    process.on("unhandledRejection", function (err, promise) {
        console.error(
            "Top level unhandled rejection (promise: ",
            promise,
            ", reason: ",
            err,
            ").",
            err,
        );
    });
}
server = createServer({ port });

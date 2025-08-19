// Catch and snuff all uncaught exceptions and uncaught promise rejections.
// We can manually restart the server if it gets into a bad state, but we want

import { normalize } from "path";
import { createServer } from "./server.mts";
import { Command } from "@commander-js/extra-typings";
import {
    execute,
    listNonDirectoryFiles,
    type ParameterValue,
    recordParameterValue,
    setAllParameterWithSource,
    setParameterWithSource,
} from "./engine.mts";

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

const program = new Command().description("HTML Wiki command line tool");
program
    .command("server")
    .description("run web server")
    .option("-i, --in-directory <string>", "where to read files", ".")
    .option("--port <number>")
    .option("--ignore-errors")
    .action((options) => {
        console.log({ options });
        if (!options.inDirectory) {
        }
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
        if (options.ignoreErrors) ignoreErrors();
        server = createServer({ port, baseDirectory: options.inDirectory });
    });

program
    .command("generate")
    .description("render and write out a static version of the site")
    .option("-i, --in-directory <string>", "where to read files", ".")
    .option("-o, --out-directory <string>", "where to write files", "./build")
    .action(async ({ inDirectory, outDirectory }) => {
        if (normalize(inDirectory) === normalize(outDirectory)) {
            console.error(
                "You probaby didn't want to write out exactly where you're reading from",
            );
            process.exit(1);
        }
        const files = await listNonDirectoryFiles({
            baseDirectory: inDirectory,
        });
        console.log(
            `Writing files to ${outDirectory}:`,
            "\n" + files.join("\n"),
        );
        files.forEach(async (contentPath) => {
            const readParameters: ParameterValue = {};
            setAllParameterWithSource(
                readParameters,
                {
                    baseDirectory: inDirectory,
                    contentPath: "/$/templates/global-page.html",
                    command: "read",
                },
                "query param",
            );
            readParameters.contentParameters = {
                value: {
                    contentPath: {
                        value: contentPath,
                        source: "query param",
                    },
                },
                source: "query param",
            };
            let outputPath = contentPath;
            if (/\.md$/.test(contentPath)) {
                outputPath = contentPath.replace(/\.md$/, ".html");
                setParameterWithSource(
                    recordParameterValue(readParameters.contentParameters),
                    "renderMarkdown",
                    "true",
                    "query param",
                );
            }
            const readResult = await execute(readParameters);

            const writeParameters: ParameterValue = {};
            setAllParameterWithSource(
                writeParameters,
                {
                    baseDirectory: outDirectory,
                    contentPath: outputPath,
                    content: readResult.content,
                    command: "create",
                },
                "query param",
            );
            const writeResult = await execute(writeParameters);
        });
    });

program.parse();

function ignoreErrors() {
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

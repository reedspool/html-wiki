// Catch and snuff all uncaught exceptions and uncaught promise rejections.
// We can manually restart the server if it gets into a bad state, but we want

import { normalize } from "path";
import { createServer } from "./server.mts";
import { Command } from "@commander-js/extra-typings";
import {
    execute,
    getContentsAndMetaOfAllFiles,
    type ParameterValue,
    setEachParameterWithSource,
    setParameterWithSource,
} from "./engine.mts";
import debug from "debug";
import { configuredFiles } from "./configuration.mts";
const log = debug("cli:main");

let server: ReturnType<typeof createServer>;

// So I can kill from local terminal with Ctrl-c
// From https://github.com/strongloop/node-foreman/issues/118#issuecomment-475902308
process.on("SIGINT", (signal) => {
    log(`Signal ${signal} received, shutting down`);
    server.cleanup();
    // Just wait some amount of time before exiting. Ideally the listener would
    // close successfully, but it seems to hang for some reason.
    setTimeout(() => process.exit(0), 150);
});

const program = new Command().description("HTML Wiki command line tool");
program
    .command("server")
    .description("run web server")
    .option("-c, --core-directory <string>", "where to read core files", "")
    .option("-u, --user-directory <string>", "where to read user files")
    .option("--port <number>")
    .option("--ignore-errors")
    .action((options) => {
        log({ options });
        if (!options.coreDirectory) {
            options.coreDirectory = configuredFiles.coreDirectory;
            log(
                `No core directory given, using default ${options.coreDirectory}`,
            );
        }
        if (!options.userDirectory) {
            throw new Error("--user-directory option is required");
        }
        let port: number;
        if (process.env.PORT !== undefined) {
            port = Number(process.env.PORT);
            log(`Using environment variable port ${port}`);
        } else if (options.port !== undefined) {
            port = Number(options.port);
            log(`Using command line option port ${port}`);
        } else {
            port = 3001;
            log(`Using default port ${port}`);
        }
        if (options.ignoreErrors) ignoreErrors();
        server = createServer({
            port,
            coreDirectory: options.coreDirectory,
            userDirectory: options.userDirectory,
        });
    });

program
    .command("generate")
    .description("render and write out a static version of the site")
    .option("-c, --core-directory <string>", "where to read core files", "")
    .option("-u, --user-directory <string>", "where to read user files")
    .option("-o, --out-directory <string>", "where to write files", "./build")
    .action(async (options) => {
        log(options);
        if (!options.coreDirectory) {
            options.coreDirectory = configuredFiles.coreDirectory;
            log(
                `No core directory given, using default ${options.coreDirectory}`,
            );
        }
        if (!options.userDirectory) {
            throw new Error("--user-directory option is required");
        }

        if (
            normalize(options.coreDirectory) ===
                normalize(options.outDirectory) ||
            normalize(options.userDirectory) === normalize(options.outDirectory)
        ) {
            log(
                "You probaby didn't want to write out exactly where you're reading from",
            );
            process.exit(1);
        }
        const files = (
            await getContentsAndMetaOfAllFiles({
                searchDirectories: [
                    options.userDirectory,
                    options.coreDirectory,
                ],
            })
        ).map(({ contentPath }) => contentPath);

        log(
            `Writing files to ${options.outDirectory}:`,
            "\n" + files.join("\n"),
        );
        log(
            `Using default page template '${configuredFiles.defaultPageTemplate}'`,
        );
        files.forEach(async (contentPath) => {
            const readParameters: ParameterValue = {};
            setEachParameterWithSource(
                readParameters,
                {
                    userDirectory: options.userDirectory,
                    coreDirectory: options.coreDirectory,
                    contentPath: configuredFiles.defaultPageTemplate,
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
                    readParameters.contentParameters as ParameterValue,
                    "renderMarkdown",
                    "true",
                    "query param",
                );
            }
            const readResult = await execute(readParameters);

            const writeParameters: ParameterValue = {};
            setEachParameterWithSource(
                writeParameters,
                {
                    // Don't give a core directory so we don't ever try to
                    // write to it.
                    userDirectory: options.outDirectory,
                    contentPath: outputPath,
                    content: readResult.content,
                    command: "create",
                },
                "query param",
            );
            await execute(writeParameters);
        });
    });

program.parse();

function ignoreErrors() {
    process.on("uncaughtException", function (err) {
        log("Top-level uncaught exception: " + err, err);
    });
    process.on("unhandledRejection", function (err, promise) {
        log(
            "Top level unhandled rejection (promise: ",
            promise,
            ", reason: ",
            err,
            ").",
            err,
        );
    });
}

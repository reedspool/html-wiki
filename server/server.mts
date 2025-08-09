/**
 * Main JS Server
 *
 * Code comments are sparse, but you're welcome to add them as you learn about
 * the system and make a PR!
 */
import express from "express";
import EventEmitter from "node:events";
import { dirname } from "node:path";
import { mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
import { parse as parseHtml } from "node-html-parser";
import { escapeHtml, html } from "./utilities.mts";
import {
    caughtToQueryError,
    fullyQualifiedEntryName,
    pathToEntryFilename,
    queryEngine,
} from "./query.mts";
import { applyTemplating } from "./dom.mts";
import { QueryError } from "./error.mts";

export const createServer = ({ port }: { port?: number }) => {
    // Create an event emitter to handle cross-cutting communications
    const emitter = new EventEmitter();

    // Only be warned if the number of listeners for a specific event goes above
    // this number. The warning will come in logs (MaxListenersExceededWarning)
    emitter.setMaxListeners(100);

    const app = express();
    const baseURL = `localhost:${port}`;

    app.use(express.urlencoded({ extended: true }));

    app.use("/", async (req, res, next) => {
        if (req.method !== "GET" || req.query.edit === undefined) {
            return next();
        }

        let entryFileName = pathToEntryFilename(req.path);
        let fileToEditContents: string;
        try {
            const fileToEdit = await readFile(
                fullyQualifiedEntryName(entryFileName),
            );
            fileToEditContents = fileToEdit.toString();
        } catch (error) {
            if (error.code === "ENOENT") {
                res.status(404);
                res.write(
                    `Couldn't find a file named ${escapeHtml(entryFileName)}`,
                );
                res.end();
                return;
            }
            console.error(
                "unknown error caught while trying to read edit file:",
                error,
            );
            throw error;
        }

        let contentType = `html`;
        // If it's not raw, then apply any templates
        if (req.query.raw === undefined) {
            // TODO: Instead of inspecting a file at read-time, try to inspect
            // this at less critical times and cache the result, e.g. when the
            // server starts, when notified the file changed on disk
            const fileRoot = parseHtml(fileToEditContents);
            await applyTemplating(fileRoot, {
                // TODO: This doesn't really make sense. Probably should return it from fileRoot instead like Go
                serverError: () => {},
                getEntryFileName: () => entryFileName,
                getQueryValue: queryEngine({
                    query: req.query,
                    fileToEditContents,
                    host: req.get("host"),
                    protocol: req.protocol,
                }),
                setContentType: (type) => {
                    contentType = type;
                },
            });

            if (contentType === "markdown") {
                fileToEditContents =
                    fileRoot.querySelector("body > code > pre").innerHTML;
            }
        }

        const editFile = await readFile(
            fullyQualifiedEntryName("$/templates/edit.html"),
        );
        const editFileContents = editFile.toString();
        const editRoot = parseHtml(editFileContents);
        await applyTemplating(editRoot, {
            // TODO: This doesn't really make sense. Probably should return it from fileRoot instead like Go
            serverError: () => {},
            getEntryFileName: () => entryFileName,
            getQueryValue: queryEngine({
                query: req.query,
                fileToEditContents,
                host: req.get("host"),
                protocol: req.protocol,
            }),
            setContentType: (type) => {
                if (type !== contentType) {
                    throw new Error(
                        `mismatch between edit and target content types (${contentType} != ${type})`,
                    );
                }
            },
        });
        res.send(editRoot.toString());
    });
    app.use("/", async (req, res, next) => {
        if (req.method !== "POST") {
            // Edit should be PUT, but forms don't support that
            return next();
        }

        if (req.query.create !== undefined) {
            const { filename, content } = req.body;
            if (typeof content !== "string" || typeof filename !== "string") {
                res.status(400);
                res.write(
                    `POST ?create requires body containing content and filename`,
                );
                res.end();
                return;
            }

            const entryFileName = /\.[a-zA-Z0-9]+$/.test(filename)
                ? filename
                : `${filename}.html`;
            try {
                await mkdir(fullyQualifiedEntryName(dirname(entryFileName)), {
                    recursive: true,
                });
                const fd = await open(
                    fullyQualifiedEntryName(entryFileName),
                    "wx",
                );
                await writeFile(
                    fd,
                    content
                        // Browser sends CRLF, replace with unix-style LF,
                        .replaceAll(/\r\n/g, "\n")
                        // Remove any extra trailing spaces (but not double newlines!)
                        .replaceAll(/[ \t\r]+\n/g, "\n"),
                );
                res.redirect(`/${entryFileName}`);
                return;
            } catch (error) {
                if (error.code === "EEXIST") {
                    res.status(422);
                    res.write(
                        `File ${escapeHtml(entryFileName)} already exists`,
                    );
                    res.end();
                    return;
                }
            }
            return;
        }

        let entryFileName = pathToEntryFilename(req.path);

        if (req.query.delete !== undefined) {
            if (req.query["delete-confirm"] === undefined) {
                res.status(400);
                // TODO: Make a template file and send this to the template instead
                res.write(
                    html`<!doctype html>
                        <html lang="en-US">
                            <head>
                                <title>Test page</title>
                            </head>
                            <body>
                                <h1>
                                    Really delete /${escapeHtml(entryFileName)}?
                                </h1>
                                <form
                                    action="/${escapeHtml(
                                        entryFileName,
                                    )}?delete&delete-confirm"
                                    method="POST"
                                >
                                    <p>
                                        Are you sure you want to delete
                                        /${escapeHtml(entryFileName)}? This
                                        action cannot be undone.
                                    </p>
                                    <button type="submit">
                                        Confirm and delete
                                    </button>
                                    <a href="/${escapeHtml(entryFileName)}"
                                        >cancel deletion and go back</a
                                    >
                                </form>
                            </body>
                        </html> `,
                );
                res.end();
                return;
            }
            try {
                await open(fullyQualifiedEntryName(entryFileName), "wx");
                res.status(404);
                res.write(`File ${escapeHtml(entryFileName)} doesn't exist`);
                res.end();
            } catch (error) {
                if (error.code === "EEXIST") {
                    rm(fullyQualifiedEntryName(entryFileName));
                    res.send(
                        `Successfully deleted ${escapeHtml(entryFileName)}`,
                    );
                    return;
                }
            }
            return;
        }

        let fileToEditContents: string;
        try {
            const fileToEdit = await readFile(
                fullyQualifiedEntryName(entryFileName),
            );
            fileToEditContents = fileToEdit.toString();
        } catch (error) {
            if (error.code === "ENOENT") {
                res.status(404);
                res.write(
                    `Couldn't find a file named ${escapeHtml(entryFileName)}`,
                );
                res.end();
                return;
            }
            console.error(
                "unknown error caught while trying to read edit file:",
                error,
            );
            throw error;
        }

        console.log(`Logging contents of ${entryFileName} before write:`);
        console.log(fileToEditContents);

        let contentToWrite = req.body.content;

        // If it's not raw, then filter/reshape the contents based on the meta
        if (req.query.raw === undefined) {
            // TODO: Instead of inspecting a file at read-time, try to inspect
            // this at less critical times and cache the result, e.g. when the
            // server starts, when notified the file changed on disk
            const fileRoot = parseHtml(fileToEditContents);
            const metaElements = fileRoot.querySelectorAll("meta");
            for (const metaElement of metaElements) {
                switch (metaElement.attributes.itemprop) {
                    case undefined:
                        break;
                    case "content-type":
                        switch (metaElement.attributes.content) {
                            case "markdown":
                                const body = fileRoot.querySelector("body");
                                const markdownContent =
                                    body?.querySelector("code > pre");
                                if (!body) {
                                    res.status(500);
                                    res.write(
                                        `No <body> found in file ${escapeHtml(entryFileName)}`,
                                    );
                                    res.end();
                                    return;
                                }
                                if (!markdownContent) {
                                    res.status(500);
                                    res.write(
                                        `No <code><pre> sequence found in file ${escapeHtml(entryFileName)}`,
                                    );
                                    res.end();
                                    return;
                                }

                                // Since the HTML content isn't supposed to be
                                // valid HTML, we can't just put it straight
                                // into the proper HTML structure So instead put
                                // a marker in there and then swap the marker
                                // for the content we want.
                                // TODO: Could we do this in a more valid way by
                                // making a TextNode, putting the content in there,
                                // and replacing the <pre> content with the text
                                // node?
                                const marker = "!!!MARKER!!!";
                                markdownContent.innerHTML = marker;
                                contentToWrite = fileRoot
                                    .toString()
                                    .replace(marker, req.body.content);
                                break;
                            default:
                                console.error(
                                    `Failed to handle content-type '${metaElement.attributes.content}' `,
                                );
                                break;
                        }
                        break;
                    default:
                        console.error(
                            `Failed to handle meta itemprop '${metaElement.attributes.itemprop}' `,
                        );
                        break;
                }
            }
        }

        await writeFile(
            fullyQualifiedEntryName(entryFileName),
            contentToWrite
                // Browser sends CRLF, replace with unix-style LF,
                .replaceAll(/\r\n/g, "\n")
                // Remove any extra trailing spaces (but not double newlines!)
                .replaceAll(/[ \t\r]+\n/g, "\n"),
        );

        res.redirect(`/${entryFileName}`);
        return;
    });

    app.use("/", async (req, res, next) => {
        // Req.query is immutable
        const query: Record<string, string> = {};
        for (const key in req.query) {
            if (typeof key != "string")
                throw new Error(`req.query key '${key}' was not a string.`);

            const value = req.query[key];
            if (typeof value != "string") {
                console.error(
                    `req.query['${key}'] was not a string: ${req.query[key]}`,
                );
                throw new Error(
                    `req.query['${key}'] was not a string. See log`,
                );
            }
            query[key] = value;
        }
        if (req.method !== "GET") {
            return next();
        }
        let entryFileName = pathToEntryFilename(req.path);
        let fileToRenderContents: string;
        if (typeof query.raw !== "undefined") {
            try {
                const fileToEdit = await readFile(
                    fullyQualifiedEntryName(entryFileName),
                );
                fileToRenderContents = fileToEdit.toString();
            } catch (error) {
                caughtToQueryError(error, { readingFileName: entryFileName });
            }

            res.send(fileToRenderContents);
            return;
        } else {
            if (query.content === undefined) {
                entryFileName = pathToEntryFilename(
                    "/$/templates/global-page.html",
                );
                query.content = req.path + `?${new URLSearchParams(query)}`;
                query.select = "body";
            }
            try {
                const fileToEdit = await readFile(
                    fullyQualifiedEntryName(entryFileName),
                );
                fileToRenderContents = fileToEdit.toString();
            } catch (error) {
                caughtToQueryError(error, { readingFileName: entryFileName });
            }
        }

        // TODO: Instead of inspecting a file at read-time, try to inspect
        // this at less critical times and cache the result, e.g. when the
        // server starts, when notified the file changed on disk
        const fileRoot = parseHtml(fileToRenderContents);
        await applyTemplating(fileRoot, {
            // TODO: This doesn't really make sense. Probably should return it from fileRoot instead like Go
            serverError: () => {},
            getEntryFileName: () => entryFileName,
            getQueryValue: queryEngine({
                query: query,
                fileToEditContents: "",
                host: req.get("host"),
                protocol: req.protocol,
            }),
            setContentType(_type) {
                throw new Error("not implemented setcontenttype");
            },
        });

        res.send(fileRoot.toString());
    });

    //
    // Final 404/5XX handlers
    //
    // NOTE: Annoyingly, this error catcher in Express relies on the number of
    //       parameters defined. So you can't remove any of these parameters
    app.use(function (
        error: unknown,
        req: express.Request,
        res: express.Response,
        _next: () => void,
    ) {
        if (error instanceof QueryError) {
            console.log(`QueryError on ${req.path}:`, error);
            res.status(error.status);
            res.write(error.message);
            res.end();
            return;
        }
        console.error("5XX", { err: error });
        res.status(500);
        res.send("500");
    });

    app.use(function (req, res) {
        res.status(404);
        res.write(
            `Couldn't find a file named ${escapeHtml(
                decodeURIComponent(req.path).slice(1), // Remove leading slash
            )}`,
        );
        res.end();
        return;
    });

    const listener = app.listen(port, () => {
        console.log(`Server is available at http://${baseURL}`);
    });

    emitter.on("cleanup", () => {
        listener.close(() => {});
    });

    return { cleanup: () => emitter.emit("cleanup") };
};

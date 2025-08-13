/**
 * Main JS Server
 *
 * Code comments are sparse, but you're welcome to add them as you learn about
 * the system and make a PR!
 */
import express from "express";
import EventEmitter from "node:events";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { mkdir, open, rm, writeFile } from "node:fs/promises";
import { escapeHtml } from "./utilities.mts";
import {
    encodedEntryPathRequest,
    expressQueryToRecord,
    fullyQualifiedEntryName,
    getEntryContents,
    pathToEntryFilename,
    queryEngine,
    urlSearchParamsToRecord,
} from "./query.mts";
import { applyTemplating } from "./dom.mts";
import { QueryError } from "./error.mts";
import {
    execute,
    narrowStringToCommand,
    type ParametersWithSource,
    type ParameterValue,
} from "./engine.mts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const baseDirectory = `${__dirname}/../entries`;

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
        // Silly chrome dev tools stuff is noisy
        if (req.path.match(/\.well-known\/appspecific\/com.chrome/)) return;
        // Req.query is immutable
        let query: ParametersWithSource[1] = expressQueryToRecord(req.query);
        let urlFacts: ParametersWithSource[1] = {
            host: req.get("host")!,
            protocol: req.protocol!,
        };

        // Merge the contents of the reuqest body into query.
        // TODO: Feels like it should be an error to have the same field in
        // both, because you could easily be accidentally overwriting yourself.
        let reqBody: ParametersWithSource[1] = req.body ? { ...req.body } : {};

        let command = narrowStringToCommand(query.command);

        // Next, try to derive the query from the method
        if (command === undefined) {
            if (req.method === "GET") {
                command = "read";
            } else if (req.method === "POST") {
                // Since we want to support basic HTML which only have GET and
                // POST to work with without JS, overload POST and look for
                // another hint as to what to do
                if (query.edit !== undefined) {
                    command = "update";
                } else if (query.delete !== undefined) {
                    command = "delete";
                } else if (query.create !== undefined) {
                    command = "create";
                } else {
                    // The most RESTful
                    command = "update";
                }
            } else if (req.method === "PUT") {
                command = "create";
            } else if (req.method === "DELETE") {
                command = "delete";
            }
        }

        if (command === undefined) {
            throw new Error(
                `Unable to derive command from method '${req.method}' and query string`,
            );
        }

        if (query.content) {
        }

        res.write(
            execute([
                ["query parameters", query],
                ["request body", reqBody],
                ["request-derived", { command }],
                ["url facts", urlFacts],
                ["server configuration", { baseDirectory }],
            ]),
        );
        next();
    });

    app.use("/", async (req, res, next) => {
        if (req.method !== "POST") {
            // Edit should be PUT, but forms don't support that
            return next();
        }

        if (req.query.create !== undefined) {
            const { filename, content } = req.body;
            if (typeof content !== "string" || typeof filename !== "string") {
                throw new QueryError(
                    500,
                    `POST ?create requires body containing content and filename`,
                );
            }

            const entryFileName = pathToEntryFilename(filename);
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
                if (
                    error instanceof Error &&
                    "code" in error &&
                    error.code === "EEXIST"
                ) {
                    throw new QueryError(
                        422,
                        `File /${escapeHtml(entryFileName)} already exists`,
                    );
                }
                throw error;
            }
        }

        let entryFileName = pathToEntryFilename(req.path);

        if (req.query.delete !== undefined) {
            if (req.query["delete-confirm"] === undefined) {
                res.status(400);
                res.write(await getEntryContents("/$/templates/delete.html"));
                res.end();
                return;
            }
            try {
                await open(fullyQualifiedEntryName(entryFileName), "wx");
                throw new QueryError(
                    404,
                    `File /${escapeHtml(entryFileName)} doesn't exist`,
                );
            } catch (error) {
                if (
                    error instanceof Error &&
                    "code" in error &&
                    error.code === "EEXIST"
                ) {
                    rm(fullyQualifiedEntryName(entryFileName));
                    res.send(
                        `Successfully deleted ${escapeHtml(entryFileName)}`,
                    );
                    return;
                }
                throw error;
            }
        }

        next();
    });

    app.use("/", async (req, res, next) => {
        // Silly chrome dev tools stuff is noisy
        if (req.path.match(/\.well-known\/appspecific\/com.chrome/)) return;
        // Req.query is immutable
        const query = expressQueryToRecord(req.query);
        query.host = req.get("host")!;
        query.protocol = req.protocol!;
        if (req.method !== "GET" && req.method !== "POST") {
            return next();
        }
        let entryFileName = pathToEntryFilename(req.path);
        let fileToRenderContents: string | undefined;
        let bodyContents: string | undefined;
        let command: "render" | "write" = "render";
        let raw: boolean = query.raw !== undefined;

        if (req.method === "POST") {
            command = "write";
            raw = true;
            if (!req.body.content) {
                throw new QueryError(
                    400,
                    "Writing to file requires a POST body",
                );
            }
            bodyContents = req.body.content;
        } else if (query.edit !== undefined) {
            entryFileName = pathToEntryFilename(
                "/$/templates/global-page.html",
            );
            query.content = encodedEntryPathRequest("/$/templates/edit.html", {
                ...query,
                select: "body",
                content: encodedEntryPathRequest(req.path, {
                    ...query,
                    raw: "raw",
                    escape: "escape",
                }),
            });
            fileToRenderContents = await getEntryContents(entryFileName);
        } else if (raw) {
            fileToRenderContents = await getEntryContents(entryFileName);
            res.send(fileToRenderContents);
            return;
        } else {
            // TODO: Want this to be discovered in the process of applyTemplating
            // so that it can be configured by the template itself e.g. in a
            // meta tag, `<meta itemprop="layout" value="my/layout.html">`
            if (query.content === undefined && !raw) {
                entryFileName = pathToEntryFilename(
                    "/$/templates/global-page.html",
                );
                const contentQuery = { ...query };
                if (/\.md$/.test(req.path)) {
                    contentQuery.renderMarkdown = "true";
                }

                contentQuery.select = "body";
                query.content = encodedEntryPathRequest(req.path, contentQuery);
            }
            fileToRenderContents = await getEntryContents(entryFileName);
        }

        // TODO: Instead of inspecting a file at read-time, try to inspect
        // this at less critical times and cache the result, e.g. when the
        // server starts, when notified the file changed on disk
        console.log(
            `Applying top-level templating for ${entryFileName} with query ${new URLSearchParams(query)}`,
            query,
        );

        switch (command) {
            case "render":
                if (fileToRenderContents === undefined) {
                    throw new QueryError(
                        400,
                        "Cannot render file with no contents",
                    );
                }
                const result = await applyTemplating(fileToRenderContents, {
                    getQueryValue: queryEngine({
                        parameters: query,
                    }),
                });

                res.send(result);
                return;
            case "write":
                if (bodyContents === undefined) {
                    throw new QueryError(
                        400,
                        "Writing to file requires POST body contents",
                    );
                }
                try {
                    await open(fullyQualifiedEntryName(entryFileName), "wx");
                    throw new QueryError(
                        404,
                        `File /${escapeHtml(entryFileName)} doesn't exist. Did you mean to create it?`,
                    );
                } catch (error) {
                    if (
                        error instanceof Error &&
                        "code" in error &&
                        error.code === "EEXIST"
                    ) {
                        let fileToEditContents: string =
                            await getEntryContents(entryFileName);

                        console.log(
                            `Logging contents of /${entryFileName} before write:`,
                        );
                        console.log(fileToEditContents);

                        await writeFile(
                            fullyQualifiedEntryName(entryFileName),
                            bodyContents
                                // Browser sends CRLF, replace with unix-style LF,
                                .replaceAll(/\r\n/g, "\n")
                                // Remove any extra trailing spaces (but not double newlines!)
                                .replaceAll(/[ \t\r]+\n/g, "\n"),
                        );
                        res.redirect(`/${entryFileName}`);
                        return;
                    }
                    throw error;
                }
        }
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
            if (error.status === 404) {
                console.log(`404: Req ${req.path}, ${error.message}`);
            } else {
                console.log(`QueryError on ${req.path}:`, error);
            }
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

export const decodeToContentParameters = (
    queryParam: string,
): ParameterValue => {
    const content = decodeURIComponent(queryParam);

    const url = `http://0.0.0.0${content}`;
    const urlParsed = URL.parse(url);
    if (urlParsed == null) {
        throw new Error(`Unable to parse url ${url}`);
    }
    const parameters: ParameterValue = urlSearchParamsToRecord(
        urlParsed.searchParams,
    );
    if (parameters.content) {
        const decodedSubParameters = decodeToContentParameters(
            parameters.content as string,
        );
        if (typeof decodedSubParameters == "string") {
            throw new Error(`Couldn't parse sub parameters ${content}`);
        }

        parameters.content = decodedSubParameters;
    }
    return {
        pathname: url,
        parameters,
    };
};

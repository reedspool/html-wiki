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
    maybeStringParameterValue,
    narrowStringToCommand,
    setAllParameterWithSource,
    setParameterWithSource,
    stringParameterValue,
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

    app.use("/", async (req, res, _next) => {
        // Silly chrome dev tools stuff is noisy
        if (req.path.match(/\.well-known\/appspecific\/com.chrome/)) return;
        // Req.query is immutable
        let query = expressQueryToRecord(req.query);
        const parameters: ParameterValue = {};
        setAllParameterWithSource(parameters, query, "query param");
        setAllParameterWithSource(parameters, req.body ?? {}, "request body");

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

        setParameterWithSource(parameters, "command", command, "derived");

        if (
            maybeStringParameterValue(parameters.contentPath) &&
            /\.md$/.test(stringParameterValue(parameters.contentPath))
        ) {
            setParameterWithSource(
                parameters,
                "renderMarkdown",
                "true",
                "derived",
            );
        }

        if (
            command === "read" &&
            maybeStringParameterValue(parameters.content)
        ) {
            // TODO: Seems silly that `content` is special and has this
            // capability. Seems like I should be able to make this happen for
            // any given parameter as a client
            const decodedContent = decodeToContentParameters(
                stringParameterValue(parameters.content),
            );
            setParameterWithSource(
                parameters,
                "contentParameters",
                decodedContent,
                "derived",
            );
            setParameterWithSource(
                parameters,
                "contentPath",
                query.contentPath ?? "/" + pathToEntryFilename(req.path),
                "derived",
            );
        }

        // Set server configuration last so it's not overridden
        setParameterWithSource(
            parameters,
            "baseDirectory",
            baseDirectory,
            "server configured",
        );

        if (
            stringParameterValue(parameters.command) == "read" &&
            maybeStringParameterValue(parameters.edit)
        ) {
            const contentPathToEdit = parameters.contentPath ?? {
                value: "/" + pathToEntryFilename(req.path),
                source: "derived",
            };
            setParameterWithSource(
                parameters,
                "contentPath",
                "/$/templates/global-page.html",
                "derived",
            );
            setParameterWithSource(
                parameters,
                "contentParameters",
                {
                    contentPath: {
                        value: `/$/templates/edit.html`,
                        source: "derived",
                    },
                    select: {
                        value: "body",
                        source: "derived",
                    },
                    contentParameters: {
                        value: {
                            raw: {
                                value: "raw",
                                source: "derived",
                            },
                            escape: {
                                value: "escape",
                                source: "derived",
                            },
                            contentPath: contentPathToEdit,
                        },
                        source: "derived",
                    },
                },
                "derived",
            );
        }

        if (
            (command == "update" ||
                command == "create" ||
                command == "delete") &&
            !maybeStringParameterValue(parameters.contentPath)
        ) {
            setParameterWithSource(
                parameters,
                "contentPath",
                "/" + pathToEntryFilename(req.path),
                "derived",
            );
        }

        // If the request didn't specify a contentPath explicitly, and we didn't derive one already (e.g. `?edit`)
        if (!maybeStringParameterValue(parameters.contentPath)) {
            setParameterWithSource(
                parameters,
                "contentPath",
                "/$/templates/global-page.html",
                "derived",
            );

            parameters.contentParameters = {
                value: {
                    select: {
                        value: "body",
                        source: "derived",
                    },
                    contentPath: {
                        value: "/" + pathToEntryFilename(req.path),
                        source: "derived",
                    },
                },
                source: "derived",
            };
            if (/\.md$/.test(req.path)) {
                setParameterWithSource(
                    parameters.contentParameters.value,
                    "renderMarkdown",
                    "true",
                    "derived",
                );
            }
        }

        const result = await execute(parameters);
        res.send(result.content);
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
    const parameters: ParameterValue = {};
    const fromParams = urlSearchParamsToRecord(urlParsed.searchParams);
    setAllParameterWithSource(parameters, fromParams, "query param");
    setParameterWithSource(
        parameters,
        "contentPath",
        urlParsed.pathname,
        "query param",
    );
    if (parameters.content) {
        const decodedSubParameters = decodeToContentParameters(
            stringParameterValue(parameters.content),
        );
        if (typeof decodedSubParameters == "string") {
            throw new Error(`Couldn't parse sub parameters ${content}`);
        }

        setParameterWithSource(
            parameters,
            "contentParameters",
            decodedSubParameters,
            "derived",
        );
    }
    return parameters;
};

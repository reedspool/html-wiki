/**
 * Main JS Server
 *
 * Code comments are sparse, but you're welcome to add them as you learn about
 * the system and make a PR!
 */
import express from "express";
import EventEmitter from "node:events";
import { escapeHtml } from "./utilities.mts";
import { contentType } from "mime-types";
import {
    expressQueryToRecord,
    pathToEntryFilename,
    urlSearchParamsToRecord,
} from "./serverUtilities.mts";
import { QueryError } from "./error.mts";
import {
    execute,
    maybeStringParameterValue,
    narrowStringToCommand,
    setEachParameterWithSource,
    setParameterChildrenWithSource,
    setParameterWithSource,
    stringParameterValue,
    type ParameterValue,
} from "./engine.mts";
import debug from "debug";
import { readFile } from "./filesystem.mts";
import { configuredFiles } from "./configuration.mts";
const log = debug("server:server");

export const createServer = ({
    port,
    baseDirectory,
}: {
    port: number;
    baseDirectory: string;
}) => {
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
        setEachParameterWithSource(parameters, query, "query param");
        setEachParameterWithSource(parameters, req.body ?? {}, "request body");

        let command = narrowStringToCommand(query.command);

        // Next, try to derive the command from the method or query parameters
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
                    if (query["delete-confirm"]) {
                        command = "delete";
                    } else {
                        command = "read";
                        res.status(400);
                    }
                } else if (query.create !== undefined) {
                    command = "create";
                } else {
                    // The most RESTful
                    command = "update";
                }
            } else if (req.method === "PUT") {
                command = "create";
            } else if (req.method === "DELETE") {
                if (query["delete-confirm"]) {
                    command = "delete";
                } else {
                    command = "read";
                    res.status(400);
                }
            }
        }

        if (command === undefined) {
            throw new Error(
                `Unable to derive command from method '${req.method}' and query string`,
            );
        }

        setParameterWithSource(parameters, "command", command, "derived");

        // TODO: This should be placed somewhere it can act consistently at all levels
        if (
            maybeStringParameterValue(parameters, "contentPath") &&
            /\.md$/.test(stringParameterValue(parameters, "contentPath")) &&
            !maybeStringParameterValue(parameters, "renderMarkdown")
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
            maybeStringParameterValue(parameters, "content")
        ) {
            // TODO: Seems silly that `content` is special and has this
            // capability. Seems like I should be able to make this happen for
            // any given parameter as a client
            const decodedContent = decodeToContentParameters(
                stringParameterValue(parameters, "content"),
            );
            setParameterChildrenWithSource(
                parameters,
                "contentParameters",
                decodedContent,
                "derived",
            );
            setParameterWithSource(
                parameters,
                "contentPath",
                query.contentPath ?? pathToEntryFilename(req.path),
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
            stringParameterValue(parameters, "command") == "read" &&
            maybeStringParameterValue(parameters, "edit")
        ) {
            const toEditContentPath =
                maybeStringParameterValue(parameters, "contentPath") ||
                pathToEntryFilename(req.path);
            setParameterWithSource(
                parameters,
                "contentPath",
                configuredFiles.defaultPageTemplate,
                "derived",
            );
            const editContentParameters: ParameterValue = {};
            const whatToEditContentParameters: ParameterValue = {};
            setEachParameterWithSource(
                whatToEditContentParameters,
                {
                    raw: "raw",
                    escape: "escape",
                    contentPath: toEditContentPath,
                },
                "derived",
            );
            setParameterChildrenWithSource(
                editContentParameters,
                "contentParameters",
                whatToEditContentParameters,
                "derived",
            );
            setEachParameterWithSource(
                editContentParameters,
                {
                    contentPath: configuredFiles.defaultEditTemplateFile,
                    select: "body",
                },
                "derived",
            );

            setParameterChildrenWithSource(
                parameters,
                "contentParameters",
                editContentParameters,
                "derived",
            );
        } else if (
            stringParameterValue(parameters, "command") == "read" &&
            maybeStringParameterValue(parameters, "delete")
        ) {
            const toDeleteContentPath =
                maybeStringParameterValue(parameters, "contentPath") ||
                pathToEntryFilename(req.path);
            setParameterWithSource(
                parameters,
                "contentPath",
                configuredFiles.defaultPageTemplate,
                "derived",
            );
            const editContentParameters: ParameterValue = {};
            const whatToEditContentParameters: ParameterValue = {};
            setEachParameterWithSource(
                whatToEditContentParameters,
                {
                    contentPath: toDeleteContentPath,
                },
                "derived",
            );
            setParameterChildrenWithSource(
                editContentParameters,
                "contentParameters",
                whatToEditContentParameters,
                "derived",
            );
            setEachParameterWithSource(
                editContentParameters,
                {
                    contentPath: configuredFiles.defaultDeleteTemplateFile,
                    select: "body",
                },
                "derived",
            );

            setParameterChildrenWithSource(
                parameters,
                "contentParameters",
                editContentParameters,
                "derived",
            );
        }

        if (
            (command == "update" ||
                command == "create" ||
                command == "delete") &&
            !maybeStringParameterValue(parameters, "contentPath")
        ) {
            setParameterWithSource(
                parameters,
                "contentPath",
                pathToEntryFilename(req.path),
                "derived",
            );
        }

        // If the request didn't specify a contentPath explicitly, and we didn't derive one already (e.g. `?edit`)
        if (
            !maybeStringParameterValue(parameters, "contentPath") &&
            command === "read" &&
            // Any file which isn't template-able by the engine (HTML or MD)
            // just gets sent back statically
            !/\.(html|md)$/.test(pathToEntryFilename(req.path))
        ) {
            log("Serving static file %s", pathToEntryFilename(req.path));
            const content = await readFile({
                baseDirectory,
                contentPath: pathToEntryFilename(req.path),
            });
            res.setHeader(
                "Content-Type",
                contentType(
                    pathToEntryFilename(req.path).match(/\.[^.]+$/)![0],
                ) || "application/octet-stream",
            );
            res.send(content);
            return;
        }

        if (!maybeStringParameterValue(parameters, "contentPath")) {
            setParameterWithSource(
                parameters,
                "contentPath",
                configuredFiles.defaultPageTemplate,
                "derived",
            );

            const contentParameters: ParameterValue = {};
            setEachParameterWithSource(
                contentParameters,
                {
                    select: "body",
                    contentPath: pathToEntryFilename(req.path),
                },
                "derived",
            );
            setParameterChildrenWithSource(
                parameters,
                "contentParameters",
                contentParameters,
                "derived",
            );
            if (/\.md$/.test(req.path)) {
                setParameterWithSource(
                    contentParameters,
                    "renderMarkdown",
                    "true",
                    "derived",
                );
            }
        }

        const result = await execute(parameters);
        if (command === "read") {
            res.setHeader(
                "Content-Type",
                (typeof parameters.contentPath === "string" &&
                    contentType(
                        parameters.contentPath.match(/\.[^.]+$/)![0],
                    )) ||
                    "application/octet-stream",
            );
            // TODO: This is silly because it's like the one instance where I'm not
            // looking at the contentPath and instead looking only at the path.
            // Suggests this is somethign the Engine should be doing instead?
            if (req.path === configuredFiles.fileMissingPageTemplate) {
                res.status(404);
            }
            res.send(result.content);
        } else if (command == "update" || command == "create") {
            res.redirect(
                `${stringParameterValue(parameters, "contentPath")}?statusMessage=${result.content}`,
            );
        } else if (command == "delete") {
            res.redirect(`/?statusMessage=${result.content}`);
        } else {
            log(
                "Didn't determine what to do with result %o from parameters %O",
                result,
                parameters,
            );
            throw new Error("Unexpected state");
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
                log(`404: Req ${req.path}, ${error.message}`);

                res.status(error.status);
                res.redirect(`/404.html?originalPath=${req.path}`);
                return;
            } else {
                log(`QueryError on ${req.path}:`, error);
            }
            res.status(error.status);
            res.write(error.message);
            res.end();
            return;
        }
        log("5XX", { err: error });
        res.status(500);
        res.send("500");
    });

    app.use(function (req, res) {
        res.status(404);
        // If the path is already the 404 page, then don't redirect as that would be infinite
        if (req.path === "/404.html") {
            res.write(
                `Couldn't find a file named ${escapeHtml(
                    decodeURIComponent(req.path).slice(1), // Remove leading slash
                )}`,
            );
            res.end();
            return;
        }

        // Otherwise, redirect to the 404 page but given this
        res.redirect(
            `${configuredFiles.fileMissingPageTemplate}?originalPath=${req.path}`,
        );
    });

    const listener = app.listen(port, (error) => {
        if (error) {
            if ("code" in error && error.code === "EADDRINUSE") {
                log("Port in use, exiting");
                process.exit(1);
            }
            log("Error when starting to listen:", error);
            process.exit(1);
        }
        log(`Server is available at http://${baseURL}`);
    });

    emitter.on("cleanup", () => {
        listener.close(() => {});
    });

    return { cleanup: () => emitter.emit("cleanup") };
};

export const decodeToContentParameters = (content: string): ParameterValue => {
    const url = `http://0.0.0.0${content}`;
    const urlParsed = URL.parse(url);
    if (urlParsed == null) {
        throw new Error(`Unable to parse url ${url}`);
    }
    const parameters: ParameterValue = {};
    const fromParams = urlSearchParamsToRecord(urlParsed.searchParams);
    setEachParameterWithSource(parameters, fromParams, "query param");
    setParameterWithSource(
        parameters,
        "contentPath",
        urlParsed.pathname,
        "query param",
    );
    if (parameters.content) {
        // Only decode the second layer, since Express decodes `req.query` once automatically
        const decodedSubParameters = decodeToContentParameters(
            decodeURIComponent(stringParameterValue(parameters, "content")),
        );
        if (typeof decodedSubParameters == "string") {
            throw new Error(`Couldn't parse sub parameters ${content}`);
        }

        setParameterChildrenWithSource(
            parameters,
            "contentParameters",
            decodedSubParameters,
            "derived",
        );
    }
    return parameters;
};

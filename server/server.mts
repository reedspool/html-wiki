/**
 * Main JS Server
 *
 * Code comments are sparse, but you're welcome to add them as you learn about
 * the system and make a PR!
 */
import express from "express";
import EventEmitter from "node:events";
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
                if (error.code === "EEXIST") {
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
                if (error.code === "EEXIST") {
                    rm(fullyQualifiedEntryName(entryFileName));
                    res.send(
                        `Successfully deleted ${escapeHtml(entryFileName)}`,
                    );
                    return;
                }
                throw error;
            }
        }

        let fileToEditContents: string = await getEntryContents(entryFileName);

        console.log(`Logging contents of /${entryFileName} before write:`);
        console.log(fileToEditContents);

        let contentToWrite = req.body.content;

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
        // Silly chrome dev tools stuff is noisy
        if (req.path.match(/\.well-known\/appspecific\/com.chrome/)) return;
        // Req.query is immutable
        const query = expressQueryToRecord(req.query);
        if (req.method !== "GET") {
            return next();
        }
        let entryFileName = pathToEntryFilename(req.path);
        let fileToRenderContents: string;
        let raw: boolean = query.raw !== undefined;
        if (query.edit !== undefined) {
            entryFileName = pathToEntryFilename(
                "/$/templates/global-page.html",
            );
            query.content = encodedEntryPathRequest("/$/templates/edit.html", {
                ...query,
                content: encodedEntryPathRequest(req.path, {
                    ...query,
                    raw: "raw",
                    escape: "escape",
                }),
            });
            query.select = "body";
            fileToRenderContents = await getEntryContents(entryFileName);
        } else if (raw) {
            fileToRenderContents = await getEntryContents(entryFileName);
            res.send(fileToRenderContents);
            return;
        } else {
            if (query.content === undefined) {
                entryFileName = pathToEntryFilename(
                    "/$/templates/global-page.html",
                );
                const contentQuery = { ...query };
                if (/\.md$/.test(req.path)) {
                    contentQuery.renderMarkdown = "true";
                }

                query.content = encodedEntryPathRequest(req.path, contentQuery);
                query.select = "body";
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
        const result = await applyTemplating(fileToRenderContents, {
            getEntryFileName: () => entryFileName,
            getQueryValue: queryEngine({
                query: query,
                fileToEditContents: "",
                host: req.get("host"),
                protocol: req.protocol,
            }),
            setContentType: (type) => {
                throw new QueryError(
                    400,
                    "Setting content type is not supported",
                );
            },
            // TODO: This should only be applied if content type is set
            // That obnoxiously relies on knowledge that this will occur
            // after the parsing and processing of the meta elements
            // But honestly I want to get rid of this special case,
            // so just support it for now.
            select: () => null,
        });

        res.send(result);
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

/**
 * Main JS Server
 *
 * Code comments are sparse, but you're welcome to add them as you learn about
 * the system and make a PR!
 */
import express from "express";
import EventEmitter from "node:events";
import { fileURLToPath, URL } from "node:url";
import { dirname } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { parse as parseHtml } from "node-html-parser";
import { escapeHtml, urlFromReq } from "./utilities.mts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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
        if (req.method !== "GET" || typeof req.query.edit === "undefined") {
            return next();
        }
        const entryFileName =
            req.path === "/"
                ? "index"
                : // Special case to allow someone to target index.html
                  // TODO: Probably don't want this to be a special case, and should
                  // automatically deal with the inclusion of a proper file extension
                  req.path === "/index.html"
                  ? "index"
                  : decodeURIComponent(req.path).slice(1); // Remove leading slash
        let fileToEditContents: string;
        try {
            const fileToEdit = await readFile(
                `${__dirname}/../entries/${entryFileName}.html`,
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
        const editFile = await readFile(
            __dirname + "/../entries/$/templates/edit.html",
        );
        const editFileContents = editFile.toString();
        const editRoot = parseHtml(editFileContents);
        const slotElements = editRoot.querySelectorAll("slot");
        for (const slotElement of slotElements) {
            switch (slotElement.attributes.name) {
                case "content":
                    slotElement.replaceWith(escapeHtml(fileToEditContents));
                    break;
                case "remove":
                    // Note: .remove() and event .replaceWith("") produce an
                    // empty line with extra whitespace
                    slotElement.innerHTML = "";
                    break;
                case "entry-link":
                    slotElement.replaceWith(
                        `<a href="/${entryFileName}">${entryFileName}</a>`,
                    );
                    break;
                default:
                    console.error(
                        `Failed to handle slot named '${slotElement.attributes.name}' `,
                    );
                    break;
            }
        }
        res.send(editRoot.toString());
    });
    app.use("/", async (req, res, next) => {
        if (req.method !== "POST") {
            return next();
        }

        let entryFileName =
            req.path === "/"
                ? "/index"
                : // Special case to allow someone to target index.html
                  // TODO: Probably don't want this to be a special case, and should
                  // automatically deal with the inclusion of a proper file extension
                  req.path === "/index.html"
                  ? "/index"
                  : null;

        if (entryFileName == null) {
            const url = urlFromReq(req);
            const urlParsed = URL.parse(url);
            console.log({ url, urlParsed });
            if (urlParsed !== null) {
                entryFileName = decodeURIComponent(urlParsed.pathname);
            }
        }

        if (entryFileName == null) {
            res.status(500);
            res.write(`Problem :-/`);
            res.end();
            return;
        }

        console.log(`Logging contents of ${entryFileName} before write:`);
        console.log(
            (
                await readFile(
                    __dirname + "/../entries" + entryFileName + ".html",
                )
            ).toString(),
        );

        writeFile(
            __dirname + "/../entries" + entryFileName + ".html",
            req.body.content
                // Browser sends CRLF, replace with unix-style LF,
                .replaceAll(/\r\n/g, "\n"),
        );

        res.redirect(entryFileName);
    });

    // You can always get the raw version of any content
    // Expect that this should achieve "/" mapping directly to `index.html`
    app.use(
        "/",
        express.static(__dirname + "/../entries", { extensions: ["html"] }),
    );

    //
    // Final 404/5XX handlers
    //
    // NOTE: Annoyingly, this error catcher in Express relies on the number of
    //       parameters defined. So you can't remove any of these parameters
    app.use(function (
        err: unknown,
        req: express.Request,
        res: express.Response,
        next: () => void,
    ) {
        console.error("5XX", { err, req, next });
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

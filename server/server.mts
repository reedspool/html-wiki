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
import { mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
import { parse as parseHtml, HTMLElement } from "node-html-parser";
import { escapeHtml, html, renderMarkdown, urlFromReq } from "./utilities.mts";
import { Temporal } from "temporal-polyfill";

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
        if (req.method !== "GET" || req.query.edit === undefined) {
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
                                fileToEditContents = markdownContent.innerHTML;
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
                case "keep":
                case "remove":
                    {
                        // The rules are exactly inverted between keep and remove
                        let shouldRemove =
                            slotElement.attributes.name === "remove";
                        switch (slotElement.attributes.if) {
                            case "raw":
                                if (req.query.raw === undefined) {
                                    shouldRemove = !shouldRemove;
                                }
                                break;
                            case undefined:
                                break;
                            default:
                                break;
                        }
                        if (shouldRemove) {
                            // Note: .remove() and event .replaceWith("") produce an
                            // empty line with extra whitespace
                            slotElement.innerHTML = "";
                            // slotElement.parentNode.removeChild(slotElement);
                        } else {
                            // TODO: Ideally we replace the slot with its contents, but I can't think of a good way to do that
                            // that doesn't have the same issue of introducing extra whitespace
                            // Note that some extra whitespace might be intentional! But my HTML validator currently doesn't like it
                            // and I want to keep it that way
                            slotElement.childNodes.forEach((node) => {
                                slotElement.after(node);
                            });
                            slotElement.innerHTML = "";
                        }
                    }
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
                await mkdir(
                    __dirname + "/../entries/" + dirname(entryFileName),
                    {
                        recursive: true,
                    },
                );
                const fd = await open(
                    __dirname + "/../entries/" + entryFileName,
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
                res.redirect(entryFileName);
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
                                    Really delete ${escapeHtml(entryFileName)}?
                                </h1>
                                <form
                                    action="${escapeHtml(
                                        entryFileName,
                                    )}?delete&delete-confirm"
                                    method="POST"
                                >
                                    <p>
                                        Are you sure you want to delete
                                        ${escapeHtml(entryFileName)}? This
                                        action cannot be undone.
                                    </p>
                                    <button type="submit">
                                        Confirm and delete
                                    </button>
                                    <a href="${escapeHtml(entryFileName)}"
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
                await open(__dirname + "/../entries/" + entryFileName, "wx");
                res.status(404);
                res.write(`File ${escapeHtml(entryFileName)} doesn't exist`);
                res.end();
            } catch (error) {
                if (error.code === "EEXIST") {
                    rm(__dirname + "/../entries/" + entryFileName);
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
                `${__dirname}/../entries/${entryFileName}`,
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
            __dirname + "/../entries" + entryFileName,
            contentToWrite
                // Browser sends CRLF, replace with unix-style LF,
                .replaceAll(/\r\n/g, "\n")
                // Remove any extra trailing spaces (but not double newlines!)
                .replaceAll(/[ \t\r]+\n/g, "\n"),
        );

        res.redirect(entryFileName);
    });

    // You can always get the raw version of any content
    // Expect that this should achieve "/" mapping directly to `index.html`
    app.use("/", async (req, res, next) => {
        if (req.method !== "GET") {
            return next();
        }
        let entryFileName =
            req.path === "/"
                ? "index"
                : // Special case to allow someone to target index.html
                  // TODO: Probably don't want this to be a special case, and should
                  // automatically deal with the inclusion of a proper file extension
                  req.path === "/index.html"
                  ? "index"
                  : decodeURIComponent(req.path).slice(1); // Remove leading slash

        if (!/.html$/.test(entryFileName)) {
            // TODO: Instead of tacking on HTML to every file, maybe try
            // actually loading the filename as given from disk and only if that
            // doesn't exist try adding a file extension
            entryFileName = entryFileName + ".html";
        }
        let fileToRenderContents: string;
        try {
            const fileToEdit = await readFile(
                `${__dirname}/../entries/${entryFileName}`,
            );
            fileToRenderContents = fileToEdit.toString();
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

        if (typeof req.query.raw !== "undefined") {
            res.send(fileToRenderContents);
            return;
        }

        // TODO: Instead of inspecting a file at read-time, try to inspect
        // this at less critical times and cache the result, e.g. when the
        // server starts, when notified the file changed on disk
        const fileRoot = parseHtml(fileToRenderContents);
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
                            body.innerHTML = renderMarkdown(
                                markdownContent.innerHTML,
                            );
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
        const replaceWithElements = fileRoot.querySelectorAll("replace-with");
        for (const replaceWithElement of replaceWithElements) {
            const attributeEntries = Object.entries(
                replaceWithElement.attributes,
            );
            const tagName = attributeEntries[0][0];
            if (attributeEntries[0][1]) {
                res.status(500);
                res.write(
                    `replace-with first attribute must be a tagName with no value, got value ${attributeEntries[0][1]}`,
                );
                res.end();
                return;
            }
            const element = new HTMLElement(tagName, {});

            for (let i = 1; i < attributeEntries.length; i++) {
                const [key, value] = attributeEntries[i];
                const match = key.match(/^x-(.*)$/);
                if (match) {
                    const realKey = match[1];
                    switch (value) {
                        case "q/query/filename":
                            element.setAttribute(
                                realKey,
                                req.query.filename
                                    ? req.query.filename.toString()
                                    : "<req.query.filename>",
                            );
                            break;
                        case "q/Now.plainDateTimeISO()":
                            element.setAttribute(
                                realKey,
                                Temporal.Now.plainDateTimeISO().toString(),
                            );
                            break;
                        default:
                            res.status(500);
                            res.write(`No value matcher for '${value}'`);
                            res.end();
                            return;
                    }
                } else {
                    element.setAttribute(key, value);
                }
            }
            replaceWithElement.replaceWith(element);
        }
        const dropIfElements = fileRoot
            .querySelectorAll("drop-if")
            .map((element) => [true, element] as const);
        const keepIfElements = fileRoot
            .querySelectorAll("keep-if")
            .map((element) => [false, element] as const);
        for (let [shouldDrop, element] of [
            ...dropIfElements,
            ...keepIfElements,
        ]) {
            const attributeEntries = Object.entries(element.attributes);
            if (attributeEntries.length > 1) {
                throw new Error("drop-/keep-if require exactly one attribute");
            }
            const conditionalKey = attributeEntries[0][0];
            const value = attributeEntries[0][1];

            let conditional = false;
            switch (conditionalKey) {
                case "truthy":
                    switch (value) {
                        case "q/query/filename":
                            {
                                conditional = req.query.filename !== undefined;
                            }
                            break;
                        default: {
                            throw new Error(
                                `Couldn't provide conditional value for ${value}`,
                            );
                        }
                    }
                    break;
                default:
                    throw new Error(
                        `Couldn't comprehend conditional attribute ${conditionalKey}`,
                    );
            }

            if (!conditional) shouldDrop = !shouldDrop;
            if (shouldDrop) element.innerHTML = "";
        }

        res.send(fileRoot.toString());
    });

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

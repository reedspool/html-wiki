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
import { readFile } from "node:fs/promises";
import { parse } from "node-html-parser";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const editFile = await readFile(__dirname + "/../templates/edit.html");
const editFileContents = editFile.toString();

export const createServer = ({ port }: { port?: number }) => {
    // Create an event emitter to handle cross-cutting communications
    const emitter = new EventEmitter();

    // Only be warned if the number of listeners for a specific event goes above
    // this number. The warning will come in logs (MaxListenersExceededWarning)
    emitter.setMaxListeners(100);

    const app = express();
    const baseURL = `localhost:${port}`;

    app.get("/edit/:entryFileName", async (req, res) => {
        const { entryFileName } = req.params;
        let fileToEditContents: string;
        try {
            const fileToEdit = await readFile(
                `${__dirname}/../entries/${entryFileName}.html`,
            );
            fileToEditContents = fileToEdit.toString();
        } catch (error) {
            if (error.code === "ENOENT") {
                res.status(404);
                res.write(`Couldn't find a file named ${entryFileName}.html`);
                res.end();
                return;
            }
            console.error(
                "unknown error caught while trying to read edit file:",
                error,
            );
            throw error;
        }
        // node-html-parser's HTMLElement has a clone method, but it just
        // parses anyways and returns a Node instead of an HTMLElement :facepalm:
        const editRootClone = parse(editFileContents);
        const slotElements = editRootClone.querySelectorAll("slot");
        for (const slotElement of slotElements) {
            switch (slotElement.attributes.name) {
                case "content":
                    slotElement.replaceWith(fileToEditContents);
                    break;
                default:
                    console.error(
                        `Failed to handle slot named '${slotElement.attributes.name}' `,
                    );
                    break;
            }
        }
        res.send(editRootClone.toString());
    });

    // TODO: Just to get started. This should be generated, not getting the
    // original content
    app.use(
        "/",
        express.static(__dirname + "/../entries", { index: "index.html" }),
    );
    app.use(
        "/index.html",
        express.static(__dirname + "/../entries", { index: "index.html" }),
    );

    // You can always get the raw version of any content
    app.use("/entries", express.static(__dirname + "/../entries"));

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

    app.use(function (_req, res) {
        res.status(404);
        res.send("404");
    });

    const listener = app.listen(port, () => {
        console.log(`Server is available at http://${baseURL}`);
    });

    emitter.on("cleanup", () => {
        listener.close(() => {});
    });

    return { cleanup: () => emitter.emit("cleanup") };
};

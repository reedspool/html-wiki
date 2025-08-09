import { fileURLToPath, URL } from "node:url";
import { dirname } from "node:path";
import { type Request } from "express";
import { Temporal } from "temporal-polyfill";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const pathToEntryFilename = (path: string) => {
  if (!/^\//.test(path)) {
    throw new Error("Path must start with a leading slash");
  }
  let entryFileName =
    path === "/"
      ? "index"
      : // Special case to allow someone to target index.html
        // TODO: Probably don't want this to be a special case, and should
        // automatically deal with the inclusion of a proper file extension
        path === "/index.html"
        ? "index"
        : path.slice(1); // Remove leading slash

  if (!/.html$/.test(entryFileName)) {
    // TODO: Instead of tacking on HTML to every file, maybe try
    // actually loading the filename as given from disk and only if that
    // doesn't exist try adding a file extension
    entryFileName = entryFileName + ".html";
  }

  // TODO: FOr some reason I did this before, maybe useful?
  // const url = urlFromReq(req);
  // const urlParsed = URL.parse(url);
  // if (urlParsed !== null) {
  //     entryFileName = decodeURIComponent(urlParsed.pathname);
  // }

  return decodeURIComponent(entryFileName);
};

export const fullyQualifiedEntryName = (entryFileName: string) =>
  `${__dirname}/../entries/${entryFileName}`;

export type Context = {
  query: Request["query"];
  fileToEditContents: string;
};
export const queryEngine =
  ({ query, fileToEditContents }: Context) =>
  async (input: string) => {
    switch (input) {
      case "q/query/filename":
        return query.filename ? query.filename.toString() : null;
      case "q/query/raw":
        return query.raw === undefined ? "" : "raw";
      case "q/Now.plainDateTimeISO()":
        return Temporal.Now.plainDateTimeISO().toString();
      case "fileToEditContents":
        return fileToEditContents;
      default:
        // TODO: This shouldn't just be a random server crashing error
        throw new Error(`No value matcher for '${input}'`);
        return;
    }
  };

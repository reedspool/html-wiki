import { fileURLToPath, URL } from "node:url";
import { parse as parseHtml } from "node-html-parser";
import { dirname } from "node:path";
import { type Request } from "express";
import { Temporal } from "temporal-polyfill";
import { applyTemplating } from "./dom.mts";
import { readFile } from "node:fs/promises";
import { escapeHtml } from "./utilities.mts";
import { QueryError } from "./error.mts";

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

export const urlSearchParamsToRecord = (params: URLSearchParams) => {
  const record = {};
  for (const [key, value] of params) {
    record[key] = value;
  }
  return record;
};
export type Context = {
  query: Request["query"] | Record<string, string>;
  fileToEditContents: string;
  protocol: string;
  host: string;
};
export const queryEngine =
  ({ query, fileToEditContents, protocol, host }: Context) =>
  async (input: string) => {
    switch (input) {
      case "q/query/title":
        return "HTML Wiki";
      case "q/query/filename":
        return query.filename ? query.filename.toString() : null;
      case "q/query/raw":
        return query.raw === undefined ? "" : "raw";
      case "q/Now.plainDateTimeISO()":
        return Temporal.Now.plainDateTimeISO().toString();
      case "fileToEditContents":
        return fileToEditContents;
      case "q/query/content":
        debugger;
        if (query.content === undefined) return "";

        const url = `${protocol}://${host}${query.content}`;
        const urlParsed = URL.parse(url);
        if (urlParsed == null) {
          throw new Error(`Unable to parse url ${url}`);
        }
        const contentEntryFileName = pathToEntryFilename(urlParsed.pathname);
        const contentFileContents =
          await getEntryContents(contentEntryFileName);
        return applyTemplating(contentFileContents, {
          // TODO: This doesn't really make sense. Probably should return it from fileRoot instead like Go
          serverError: () => {},
          getEntryFileName: () => contentEntryFileName,
          getQueryValue: queryEngine({
            query: urlSearchParamsToRecord(urlParsed.searchParams),
            fileToEditContents: "",
            host,
            protocol,
          }),
          setContentType(type) {
            throw new Error("not implemented setcontenttype");
          },
          select: query.select.toString(),
        });
      default:
        // TODO: This shouldn't just be a random server crashing error
        throw new Error(`No value matcher for '${input}'`);
        return;
    }
  };

export const caughtToQueryError = (
  error: unknown,
  details: { readingFileName: string },
) => {
  if (error instanceof Error) {
    if ("code" in error && error.code === "ENOENT") {
      return new QueryError(
        404,
        `Couldn't find a file named ${escapeHtml(details.readingFileName)}`,
        error,
      );
    }
  }

  throw new QueryError(500, "Unknown error", error);
};

export const getEntryContents = async (filename: string) => {
  try {
    const contentFile = await readFile(fullyQualifiedEntryName(filename));
    return contentFile.toString();
  } catch (error) {
    throw caughtToQueryError(error, {
      readingFileName: filename,
    });
  }
};

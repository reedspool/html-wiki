import { fileURLToPath, URL } from "node:url";
import { dirname } from "node:path";
import { type Request } from "express";
import { Temporal } from "temporal-polyfill";
import { applyTemplating } from "./dom.mts";
import { readFile } from "node:fs/promises";
import { escapeHtml, renderMarkdown } from "./utilities.mts";
import { QueryError } from "./error.mts";
import { type ParameterValue } from "./engine.mts";

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

  // Only if there's no extension at all
  if (!/\.[a-zA-Z0-9]+$/.test(entryFileName)) {
    entryFileName = entryFileName + ".html";
  }

  return decodeURIComponent(entryFileName);
};

export const fullyQualifiedEntryName = (entryFileName: string) =>
  `${__dirname}/../entries/${entryFileName}`;

export const urlSearchParamsToRecord = (
  params: URLSearchParams,
): Record<string, string> => {
  const record: Record<string, string> = {};
  for (const [key, value] of params) {
    record[key] = value;
  }
  return record;
};
export type Context = {
  parameters: ParameterValue;
};
export type GetQueryValue = ReturnType<typeof queryEngine>;
export const queryEngine =
  ({ parameters }: Context) =>
  async (input: string) => {
    switch (input) {
      case "q/query/title":
        // TODO: I have 10 different ways of doing this query stuff, probably just this one is best
        return parameters.title || "";
      case "q/query/select":
        return parameters.select || "";
      case "q/query/filename":
        return parameters.contentPath ? parameters.contentPath.toString() : "";
      case "q/query/raw":
        return parameters.raw === undefined ? "" : "raw";
      case "q/Now.plainDateTimeISO()":
        return Temporal.Now.plainDateTimeISO().toString();
      case "q/query/escape":
        return parameters.escape === undefined ? "" : "escape";
      case "q/query/content/filename": {
        if (parameters.contentPath === undefined) return "";
        return parameters.contentPath;
      }

      case "q/query/content":
        if (typeof parameters.contentPath !== "string")
          return "No content query provided";

        const content = decodeURIComponent(parameters.contentPath);

        const url = `${parameters.protocol}://${parameters.host}${content}`;
        const urlParsed = URL.parse(url);
        if (urlParsed == null) {
          throw new Error(`Unable to parse url ${url}`);
        }
        const contentEntryFileName = pathToEntryFilename(urlParsed.pathname);
        const contentFileContents =
          await getEntryContents(contentEntryFileName);
        // const contentQuery = urlSearchParamsToRecord(urlParsed.searchParams);
        const contentQuery = parameters.contentParameters;
        if (!contentQuery)
          throw new Error("Cannot retrieve subcontent, no content parameters");
        if (typeof contentQuery === "string")
          throw new Error("Subcontent was a string, expected a map");
        console.log(
          `Applying in-query templating for ${content} original query ${JSON.stringify(parameters)} and content query ${JSON.stringify(contentQuery)}`,
        );
        if ("raw" in contentQuery && typeof contentQuery.raw === "string") {
          return contentFileContents;
        }
        if (contentQuery.renderMarkdown !== undefined) {
          // TODO: Maybe in the future this can also apply templating? Why shouldn't it?
          return renderMarkdown(contentFileContents);
        }
        return applyTemplating(contentFileContents, {
          getQueryValue: queryEngine({
            parameters: contentQuery,
          }),
        });
      default:
        // TODO: This shouldn't just be a random server crashing error
        throw new QueryError(500, `No value matcher for '${input}'`);
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

export const encodedEntryPathRequest = (
  entryFileName: string,
  query: Record<string, string>,
) => encodeURIComponent(`${entryFileName}?${new URLSearchParams(query)}`);

export const expressQueryToRecord = (
  reqQuery: Request["query"],
): Record<string, string> => {
  const query: Record<string, string> = {};
  for (const key in reqQuery) {
    if (typeof key != "string")
      throw new Error(`req.query key '${key}' was not a string.`);

    const value = reqQuery[key];
    if (typeof value != "string") {
      console.error(`req.query['${key}'] was not a string: ${reqQuery[key]}`);
      throw new Error(`req.query['${key}'] was not a string. See log`);
    }
    query[key] = value;
  }
  return query;
};

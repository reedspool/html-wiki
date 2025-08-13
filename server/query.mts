import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { type Request } from "express";
import { Temporal } from "temporal-polyfill";
import { applyTemplating } from "./dom.mts";
import { escapeHtml, renderMarkdown } from "./utilities.mts";
import { QueryError } from "./error.mts";
import {
  maybeRecordParameterValue,
  maybeStringParameterValue,
  recordParameterValue,
  stringParameterValue,
  type ParameterValue,
} from "./engine.mts";
import { readFile } from "./filesystem.mts";

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
    // When a query string has no value, e.g. `?raw`, its value is an empty string
    record[key] = value === "" ? key : value;
  }
  return record;
};
export type Context = {
  parameters: ParameterValue;
  topLevelParameters: ParameterValue;
};
export type GetQueryValue = ReturnType<typeof queryEngine>;
export const queryEngine =
  ({ parameters, topLevelParameters }: Context) =>
  async (input: string) => {
    switch (input) {
      case "q/query/title":
        // TODO: I have 10 different ways of doing this query stuff, probably just this one is best
        return maybeStringParameterValue(parameters.title) || "";
      case "q/query/select":
        return maybeStringParameterValue(parameters.select) || "";
      case "q/query/contentPath":
        return maybeStringParameterValue(parameters.contentPath) || "";
      case "q/query/filename":
        // TODO: I'm conflating the idea of `q/query` even within my own stuff.
        // This should just be q/query/contentPath if it's supposed to find the
        // exact value of parameters (and should it be q/parameters instead to
        // target the unified parameters?)
        // And this bit me already because I was using it to refer to the
        // file name
        return maybeStringParameterValue(topLevelParameters.filename) || "";
      case "q/query/raw":
        return maybeStringParameterValue(parameters.raw) || "";
      case "q/Now.plainDateTimeISO()":
        return Temporal.Now.plainDateTimeISO().toString();
      case "q/query/escape":
        return maybeStringParameterValue(parameters.escape) || "";
      case "q/query/content/filename": {
        if (
          typeof parameters.contentParameters !== "object" ||
          recordParameterValue(parameters.contentParameters).contentPath ===
            undefined
        )
          return "";
        return stringParameterValue(
          recordParameterValue(parameters.contentParameters).contentPath,
        );
      }

      case "q/query/content": {
        const subParameters = maybeRecordParameterValue(
          parameters.contentParameters,
        );
        if (
          !subParameters ||
          typeof subParameters.contentPath.value !== "string"
        )
          // TODO: This should just be blank, or maybe another falsy value
          return "";

        const contentFileContents = await readFile({
          baseDirectory: stringParameterValue(topLevelParameters.baseDirectory),
          contentPath: stringParameterValue(subParameters.contentPath),
        });

        console.log(
          `Applying in-query templating for ${stringParameterValue(parameters.contentPath)} original query ${JSON.stringify(parameters)} and content query ${JSON.stringify(subParameters)}`,
        );
        if (maybeStringParameterValue(subParameters.raw)) {
          return contentFileContents;
        }
        if (maybeStringParameterValue(subParameters.renderMarkdown)) {
          return renderMarkdown(contentFileContents);
        }
        return applyTemplating(contentFileContents, {
          getQueryValue: queryEngine({
            parameters: subParameters,
            topLevelParameters,
          }),
        });
      }
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

export const getEntryContents = async (_filename: string) => {
  return "";
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
    // When a query string has no value, e.g. `?raw`, its value is an empty string
    query[key] = value === "" ? key : value;
  }
  return query;
};

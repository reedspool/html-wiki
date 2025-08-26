import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { type Request } from "express";
import { Temporal } from "temporal-polyfill";
import { applyTemplating } from "./dom.mts";
import { escapeHtml, renderMarkdown } from "./utilities.mts";
import { QueryError } from "./error.mts";
import {
  listNonDirectoryFiles,
  maybeRecordParameterValue,
  maybeStringParameterValue,
  stringParameterValue,
  type ParameterValue,
} from "./engine.mts";
import { readFile } from "./filesystem.mts";
import debug from "debug";
const log = debug("server:query");

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
      case "q/query/select":
      case "q/query/contentPath":
      case "q/query/escape":
      case "q/query/raw": {
        const field = input.split("/")[2]!;
        return maybeStringParameterValue(parameters[field]) || "";
      }
      // Working on this concept that "params" refers to the original query?
      // This isn't consistent, and it's surprising. Probably need a concept of scope and
      // shadowing
      case "q/params/statusMessage":
      case "q/param/filename": {
        const field = input.split("/")[2]!;
        return maybeStringParameterValue(topLevelParameters[field]) || "";
      }
      case "q/site/allFiles":
        return await listNonDirectoryFiles({
          baseDirectory: stringParameterValue(topLevelParameters.baseDirectory),
        });
      case "q/Now.plainDateTimeISO()":
        return Temporal.Now.plainDateTimeISO().toString();
      case "q/render/content": {
        if (!parameters.contentParameters) return "";
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

        log(
          `Applying in-query templating for ${stringParameterValue(parameters.contentPath)} original query ${JSON.stringify(parameters)} and content query ${JSON.stringify(subParameters)}`,
        );
        // TODO: I think "noApply" is more accurate than "raw", however can
        // probably come up with a better name. The point is "raw" implies too
        // much, or could mean several things, so I should pick some more narrow
        // concepts, even if they have to be mixed and matched
        if (maybeStringParameterValue(subParameters.raw)) {
          if (subParameters.escape) {
            return escapeHtml(contentFileContents);
          }
          return contentFileContents;
        }
        if (maybeStringParameterValue(subParameters.renderMarkdown)) {
          return renderMarkdown(contentFileContents);
        }
        return (
          await applyTemplating({
            content: contentFileContents,
            parameters: subParameters,
            topLevelParameters,
          })
        ).content;
      }
      case "q/query/contentParameters/contentPath":
      case "q/params/currentListItem/contentPath":
      case "q/params/currentListItem/name": {
        const field = input.split("/")[2]!;
        const subField = input.split("/")[3]!;
        const param = parameters[field];
        if (!param) return "";
        const record = maybeRecordParameterValue(param)?.[subField];
        if (!record) return "";
        return maybeStringParameterValue(record);
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
      log(`req.query['${key}'] was not a string: ${reqQuery[key]}`);
      throw new Error(`req.query['${key}'] was not a string. See log`);
    }
    // When a query string has no value, e.g. `?raw`, its value is an empty string
    query[key] = value === "" ? key : value;
  }
  return query;
};

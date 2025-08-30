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

export const pathToEntryFilename = (path: string) => {
  path = decodeURIComponent(path);
  if (!/^\//.test(path)) {
    throw new Error("Path must start with a leading slash");
  }
  if (path === "/") return "/index.html";

  // Only if there's no extension at all
  if (!/\.[a-zA-Z0-9]+$/.test(path)) {
    path = path + ".html";
  }

  return path;
};

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
          !maybeStringParameterValue(subParameters.contentPath)
        )
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
          // TODO if this set contents instead of returning that would seem to enable template values in markdown
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

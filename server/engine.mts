import { applyTemplating } from "./dom.mts";
import {
    createFileAndDirectories,
    listAllDirectoryContents,
    readFile,
    removeFile,
    updateFile,
} from "./filesystem.mts";
import debug from "debug";
import { escapeHtml } from "./utilities.mts";
import { pString } from "./queryLanguage.mts";
const log = debug("server:engine");

// Parameters come in tagged with a source to enable specific diagnostic reports
// on where certain values came from. Parameters are validated to turn into a
// much more specifically typed Request
export type ParameterValue = Record<string | number | symbol, unknown>;
export type ParametersWithSource = [string, ParameterValue];

// The high level operation to perform
export type Command =
    | "create" // Write to a new file
    | "read" // Get file contents
    | "update" // Write to an existing file
    | "delete"; // Delete

export const Status = {
    ServerError: 500, // Mysterious/hidden error
    ClientError: 400, // Request isn't right
    NotFound: 404, // File not found
    OK: 200, // Success
} as const;
export type Status = typeof Status;

// "Path absolute URL string" (starting with slash), but still relative to baseDirectory
export type ContentPath = string;

// Where to start looking for paths. Should have no final slash such that
// if you concatenate `contentPath` and `baseDirectory` you get a valid
// file path on this file system.
export type BaseDirectory = string;

export type ReadParameters = {
    contentPath?: string;
    select?: string;
    title?: string;
    raw?: string;
    escape?: string;
    renderMarkdown?: string;
    contentParameters?: ReadParameters;
};
export type Request = {
    contentPath: ContentPath;
    baseDirectory: BaseDirectory;
} & (
    | {
          command: "create";
          content: string;
      }
    | {
          command: "read";
          parameters: ReadParameters;
      }
    | {
          command: "update";
          content: string;
      }
    | {
          command: "delete";
      }
);
export type Result = {
    // A shorthand signifier for what the result signifies
    status: Status[keyof Status];
    // The complete stringified result. Not necessarily the content rendered.
    content: string;
};
export const execute = async (parameters: ParameterValue): Promise<Result> => {
    // NOTE: Despite TypeScript, it's on us to explicitly validate every property

    log("Engine executing parameters: %O", parameters);
    const validationIssues: Array<string> = [];
    if (!parameters.baseDirectory) {
        validationIssues.push("baseDirectory required");
    }
    if (!parameters.contentPath) {
        validationIssues.push("contentPath required");
    }
    let command: Command | undefined = narrowStringToCommand(
        stringParameterValue(parameters, "command"),
    );
    if (!command) {
        validationIssues.push(`command must be one of ${commands}`);
    }
    switch (command) {
        case "create": {
            // TODO: Whoops reusing this special value
            if (!parameters.content) {
                validationIssues.push("content required");
            }
            if (
                stringParameterValue(parameters, "contentPath").charAt(0) !==
                "/"
            ) {
                setParameterWithSource(
                    parameters,
                    "contentPath",
                    "/" + stringParameterValue(parameters, "contentPath"),
                    "derived",
                );
            }
            if (validationIssues.length > 0)
                return validationErrorResponse(validationIssues);

            await createFileAndDirectories({
                baseDirectory: stringParameterValue(
                    parameters,
                    "baseDirectory",
                ),
                contentPath: stringParameterValue(parameters, "contentPath"),
                content: stringParameterValue(parameters, "content"),
            });
            return {
                status: Status.OK,
                content: `File ${stringParameterValue(parameters, "contentPath")} created successfully`,
            };
        }
        case "read": {
            validateReadParameters(validationIssues, parameters);
            if (validationIssues.length > 0)
                return validationErrorResponse(validationIssues);
            const getQueryValue = (query: string) =>
                pString(query, {
                    parameters: parameters,
                    topLevelParameters: parameters,
                });
            const fileContents = await readFile({
                baseDirectory: stringParameterValue(
                    parameters,
                    "baseDirectory",
                ),
                contentPath: stringParameterValue(parameters, "contentPath"),
            });
            const content = (await getQueryValue("parameters.raw"))
                ? (await getQueryValue("parameters.escape"))
                    ? escapeHtml(fileContents)
                    : fileContents
                : (
                      await applyTemplating({
                          content: fileContents,
                          parameters: parameters,
                          topLevelParameters: parameters,
                      })
                  ).content;
            return {
                status: Status.OK,
                content,
            };
        }
        case "update": {
            if (!parameters.content) {
                validationIssues.push("content required");
            }
            if (validationIssues.length > 0)
                return validationErrorResponse(validationIssues);
            await updateFile({
                baseDirectory: stringParameterValue(
                    parameters,
                    "baseDirectory",
                ),
                contentPath: stringParameterValue(parameters, "contentPath"),
                content: stringParameterValue(parameters, "content"),
            });
            return {
                status: Status.OK,
                content: `File ${stringParameterValue(parameters, "contentPath")} updated successfully`,
            };
        }
        case "delete": {
            if (validationIssues.length > 0)
                return validationErrorResponse(validationIssues);
            await removeFile({
                baseDirectory: stringParameterValue(
                    parameters,
                    "baseDirectory",
                ),
                contentPath: stringParameterValue(parameters, "contentPath"),
            });
            return {
                status: Status.OK,
                content: `File ${stringParameterValue(parameters, "contentPath")} deleted successfully`,
            };
        }
        default:
            throw new Error(
                `Unhandled command '${stringParameterValue(parameters, "command")}'`,
            );
    }
};

export const validationErrorResponse = (validationIssues: Array<string>) => ({
    status: Status.ClientError,
    content: `Templating engine request wasn't valid, issues: ${validationIssues.join("; ")}.`,
});
export const validateReadParameters = (
    validationIssues: Array<string>,
    parameters: ParameterValue,
) => {
    if (!parameters.contentPath) {
        validationIssues.push("contentPath required");
    }
    // TODO: Validate contentPath, something which says it's valid? Maybe check that the file exists?
    if (
        parameters.contentParameters &&
        maybeRecordParameterValue(parameters.contentParameters)
    ) {
        if (typeof parameters.contentParameters !== "object") {
            validationIssues.push(
                "contentParameters should be a map of parameters",
            );
        } else {
            validateReadParameters(
                validationIssues,
                // Casting because the hope is we're safely validating. Could
                // probably use more tests
                recordParameterValue(
                    parameters.contentParameters,
                ) as ParameterValue,
            );
        }
    }
};

const commands = ["create", "read", "update", "delete"] as const;
export const narrowStringToCommand: (
    maybeCommand: unknown,
) => Command | undefined = (maybeCommand) => {
    if (typeof maybeCommand !== "string") return undefined;
    let command: Command | undefined;
    for (const cmd of commands) {
        command = maybeCommand == cmd ? maybeCommand : command;
    }
    return command;
};

export type ParameterSources =
    | "derived"
    | "query param"
    | "request body"
    | "url facts"
    | "server configured";
export const setParameterWithSource = (
    parameters: ParameterValue | string,
    key: keyof ParameterValue,
    value: ParameterValue[string],
    source: ParameterSources,
): ParameterValue => {
    if (typeof parameters === "string")
        throw new Error(`Can't set parameter on ${parameters}`);
    const original = parameters[key];
    if (original) {
        log(
            `Overwriting parameter '${String(key)}' to '${value}' (${source}) from '${original}' (original.source)`,
        );
    }

    parameters[key] = value;
    return parameters;
};

export const setEachParameterWithSource = (
    parameters: ParameterValue,
    record: Record<string, ParameterValue[string]>,
    source: ParameterSources,
): ParameterValue => {
    Object.entries(record).forEach(([key, value]) => {
        setParameterWithSource(parameters, key, value, source);
    });
    return parameters;
};

export const setParameterChildrenWithSource = (
    parameters: ParameterValue | string,
    key: keyof ParameterValue,
    value: ParameterValue,
    source: ParameterSources,
): ParameterValue => {
    if (typeof parameters === "string")
        throw new Error(`Can't set parameter on ${parameters}`);
    const original = parameters[key];
    if (original) {
        log(
            `Overwriting parameter '${String(key)}' to '${value}' (${source}) from '${original}' (original.source)`,
        );
    }

    // TODO: I think this is no longer any different at all
    parameters[key] = value;
    return parameters;
};

export const stringParameterValue = (
    parameterV: unknown,
    property: string,
): string => {
    // Temporarily and carefully cast
    const parameterVCasted = parameterV as ParameterValue;
    const parameter =
        property in parameterVCasted && parameterVCasted[property];
    if (typeof parameter !== "string") throw new Error("String required");
    return parameter;
};

export const maybeStringParameterValue = (
    parameterV: unknown,
    property: string,
): string | null => {
    // Temporarily and carefully cast
    const parameterVCasted = parameterV as ParameterValue;
    const parameter =
        property in parameterVCasted && parameterVCasted[property];
    if (!parameter || typeof parameter !== "string") return null;
    return parameter;
};

// TODO: I don't think this has any value anymore... since anything can be an
// object in JavaScript.
export const recordParameterValue = (
    parameter: ParameterValue["string"],
): unknown => {
    if (!parameter) throw new Error("Object required");
    return parameter;
};

export const maybeRecordParameterValue = (
    parameter: ParameterValue["string"],
): unknown | null => {
    if (!parameter) return null;
    return parameter;
};

export const getMeta = async ({
    contentPath,
    baseDirectory,
}: {
    contentPath: string;
    baseDirectory: string;
}) => {
    if (!/\.html$/.test(contentPath)) return {};
    const fileContents = await readFile({
        baseDirectory,
        contentPath,
    });
    try {
        return (
            await applyTemplating({
                content: fileContents,
                parameters: {},
                topLevelParameters: {},
                stopAtSelector: "body",
            })
        ).meta;
    } catch (error) {
        log(fileContents);
        throw new Error(
            `Couldn't apply templating for '${contentPath}': ${error}`,
        );
    }
};

export const listNonDirectoryFiles = async ({
    baseDirectory,
}: {
    baseDirectory: string;
}) => {
    const allDirents = await listAllDirectoryContents({ baseDirectory });
    return Promise.all(
        allDirents
            .filter(({ type }) => type === "file")
            .map(async (dirent) => {
                return {
                    ...dirent,
                    meta: await getMeta({
                        contentPath: dirent.contentPath,
                        baseDirectory,
                    }),
                };
            }),
    );
};

import { applyTemplating } from "./dom.mts";
import {
    createFileAndDirectories,
    listAllDirectoryContents,
    readFile,
    removeFile,
    updateFile,
} from "./filesystem.mts";
import { queryEngine } from "./query.mts";
import debug from "debug";
const log = debug("server:engine");

// Parameters come in tagged with a source to enable specific diagnostic reports
// on where certain values came from. Parameters are validated to turn into a
// much more specifically typed Request
export type ParameterValue = Record<
    string | number | symbol,
    {
        value?: unknown;
        children?: ParameterValue;
        source: ParameterSources;
    }
>;
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
        stringParameterValue(parameters.command),
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
            if (validationIssues.length > 0)
                return validationErrorResponse(validationIssues);

            await createFileAndDirectories({
                baseDirectory: stringParameterValue(parameters.baseDirectory),
                contentPath: stringParameterValue(parameters.contentPath),
                content: stringParameterValue(parameters.content),
            });
            return {
                status: Status.OK,
                content: `File ${stringParameterValue(parameters.contentPath)} created successfully`,
            };
        }
        case "read": {
            validateReadParameters(validationIssues, parameters);
            if (validationIssues.length > 0)
                return validationErrorResponse(validationIssues);
            const getQueryValue = queryEngine({
                parameters: parameters,
                topLevelParameters: parameters,
            });
            const fileContents = await readFile({
                baseDirectory: stringParameterValue(parameters.baseDirectory),
                contentPath: stringParameterValue(parameters.contentPath),
            });
            const content = (await getQueryValue("q/query/raw"))
                ? fileContents
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
                baseDirectory: stringParameterValue(parameters.baseDirectory),
                contentPath: stringParameterValue(parameters.contentPath),
                content: stringParameterValue(parameters.content),
            });
            return {
                status: Status.OK,
                content: `File ${stringParameterValue(parameters.contentPath)} updated successfully`,
            };
        }
        case "delete": {
            if (validationIssues.length > 0)
                return validationErrorResponse(validationIssues);
            await removeFile({
                baseDirectory: stringParameterValue(parameters.baseDirectory),
                contentPath: stringParameterValue(parameters.contentPath),
            });
            return {
                status: Status.OK,
                content: `File ${stringParameterValue(parameters.contentPath)} deleted successfully`,
            };
        }
        default:
            throw new Error(
                `Unhandled command '${stringParameterValue(parameters.command)}'`,
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
                recordParameterValue(parameters.contentParameters),
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
    value: ParameterValue[string]["value"],
    source: ParameterSources,
) => {
    if (typeof parameters === "string")
        throw new Error(`Can't set parameter on ${parameters}`);
    const original = parameters[key];
    if (original) {
        log(
            `Overwriting parameter '${String(key)}' to '${value}' (${source}) from '${original.value}' (original.source)`,
        );
    }

    parameters[key] = { value, source };
};

export const setAllParameterWithSource = (
    parameters: ParameterValue,
    record: Record<string, string>,
    source: ParameterSources,
) => {
    Object.entries(record).forEach(([key, value]) => {
        setParameterWithSource(parameters, key, value, source);
    });
};

export const stringParameterValue = (
    parameter: ParameterValue["string"],
): string => {
    if (typeof parameter.value !== "string") throw new Error("String required");
    return parameter.value;
};

export const maybeStringParameterValue = (
    parameter: ParameterValue["string"],
): string | null => {
    if (!parameter || typeof parameter.value !== "string") return null;
    return parameter.value;
};

export const recordParameterValue = (
    parameter: ParameterValue["string"],
): ParameterValue => {
    if (!parameter.children) throw new Error("Object required");
    return parameter.children;
};

export const maybeRecordParameterValue = (
    parameter: ParameterValue["string"],
): ParameterValue | null => {
    if (!parameter.children) return null;
    return parameter.children;
};

export const listNonDirectoryFiles = async ({
    baseDirectory,
}: {
    baseDirectory: string;
}) => {
    const allDirents = await listAllDirectoryContents({ baseDirectory });
    return allDirents
        .filter(({ type }) => type === "file")
        .map(({ contentPath }) => contentPath);
};

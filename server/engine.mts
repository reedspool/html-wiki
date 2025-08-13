import { applyTemplating } from "./dom.mts";
import {
    createFileAndDirectories,
    readFile,
    removeFile,
    updateFile,
} from "./filesystem.mts";
import { queryEngine } from "./query.mts";

// Parameters come in tagged with a source to enable specific diagnostic reports
// on where certain values came from. Parameters are validated to turn into a
// much more specifically typed Request
export type ParameterValue = { [key: string]: string | ParameterValue };
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
    host: string;
    protocol: string;
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
export const execute = async (
    parameterSources: ParametersWithSource[],
): Promise<Result> => {
    // NOTE: `as Request` means it's on us to explicitly validate every property
    const parameters: Request = parameterSources.reduce<ParameterValue>(
        (acc, [_, mem]) => ({ ...acc, ...mem }),
        {},
    ) as Request;

    const validationIssues: Array<string> = [];
    if (parameters.baseDirectory) {
        validationIssues.push("baseDirectory required");
    }
    if (!parameters.contentPath) {
        validationIssues.push("contentPath required");
    }
    let command: Command | undefined = narrowStringToCommand(
        parameters.command,
    );
    if (!command) {
        validationIssues.push(`command must be one of ${commands}`);
    }
    switch (parameters.command) {
        case "create": {
            if (!parameters.content) {
                validationIssues.push("content required");
            }
            if (validationIssues.length > 0)
                return validationErrorResponse(validationIssues);

            await createFileAndDirectories(parameters);
            return {
                status: Status.OK,
                content: `File ${parameters.contentPath} created successfully`,
            };
        }
        case "read": {
            validateReadParameters(validationIssues, parameters);
            if (validationIssues.length > 0)
                return validationErrorResponse(validationIssues);
            const fileContents = await readFile(parameters);
            const content = await applyTemplating(fileContents, {
                getQueryValue: queryEngine({ parameters }),
            });
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
            await updateFile(parameters);
            return {
                status: Status.OK,
                content: `File ${parameters.contentPath} updated successfully`,
            };
        }
        case "delete": {
            if (validationIssues.length > 0)
                return validationErrorResponse(validationIssues);
            await removeFile(parameters);
            return {
                status: Status.OK,
                content: `File ${parameters.contentPath} deleted successfully`,
            };
        }
        default:
            const never: never = parameters;
            throw new Error(`Unhandled command '${never}'`);
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
    if (!parameters.host) {
        validationIssues.push("host required");
    }
    if (!parameters.protocol) {
        validationIssues.push("protocol required");
    }
    if (!parameters.contentPath) {
        validationIssues.push("contentPath required");
    }
    // TODO: Validate contentPath, something which says it's valid? Maybe check that the file exists?
    if (parameters.contentParameters) {
        if (typeof parameters.contentParameters === "string") {
            validationIssues.push(
                "contentParameters should be a map of parameters, got a string",
            );
        } else {
            validateReadParameters(
                validationIssues,
                parameters.contentParameters,
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

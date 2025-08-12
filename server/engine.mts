export type Request = {
    // What to do with the result
    command:
        | "render" // Render the content to the result string
        | "write"; // Write to a file
    // "Path absolute URL string" (starting with slash), but still relative to baseDirectory
    contentPath: string;
    // Where to start looking for paths. Should have no final slash such that
    // if you concatenate `contentPath` and `baseDirectory` you get a valid
    // file path on this file system.
    baseDirectory: string;
};
export type Result = {
    // A shorthand signifier for what the result signifies
    status:
        | 500 // Mysterious/hidden error
        | 404 // File not found
        | 200; // Success
    // The complete stringified result. Not necessarily the content rendered.
    string: string;
};
export const execute = (request: Request): Result => {
    return {
        status: 404,
        string: "",
    };
};

export class QueryError extends Error {
    status: number;
    originalError: unknown;
    constructor(status: number, message: string, originalError?: unknown) {
        super(message);
        this.status = status;
        this.originalError = originalError;
    }
}

export class MissingFileQueryError extends QueryError {
    missingPath: string;
    constructor(missingPath: string, originalError?: unknown) {
        super(404, `Couldn't find expected file at '${missingPath}'`, originalError);
        this.missingPath = missingPath;
    }
}

export class QueryError extends Error {
    status: number;
    originalError: unknown;
    constructor(status: number, message: string, originalError: unknown) {
        super(message);
        this.status = status;
        this.originalError = originalError;
    }
}

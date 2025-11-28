export class QueryError extends Error {
  status: number
  originalError: unknown
  constructor(status: number, message: string, originalError?: unknown) {
    super(message)
    this.status = status
    this.originalError = originalError
  }
}

export class MissingFileQueryError extends QueryError {
  missingPath: string
  constructor(missingPath: string, originalError?: unknown) {
    super(404, `Couldn't find expected file at '${missingPath}'`, originalError)
    this.missingPath = missingPath
  }
}

export type AnswerErrorFileLocation = { line: number; column?: number }
export class AnswerError extends QueryError {
  filePath: string
  fileLocation: AnswerErrorFileLocation
  failingQuery: string
  constructor(
    filePath: string,
    fileLocation: AnswerErrorFileLocation,
    failingQuery: string,
    originalError?: unknown,
  ) {
    // Making my own status code 522, like a 422
    // where the request was good but a processing error of existing client code led to an error
    // https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status/422
    const message = `Could not process query '${failingQuery}' on page ${fileLocation.column === undefined ? `${filePath}:${fileLocation.line}` : `${filePath}:${fileLocation.line}:${fileLocation.column}`}`
    super(522, message, originalError)
    this.filePath = filePath
    this.fileLocation = fileLocation
    this.failingQuery = failingQuery
  }
}

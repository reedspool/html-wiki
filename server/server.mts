/**
 * Main JS Server
 *
 * Code comments are sparse, but you're welcome to add them as you learn about
 * the system and make a PR!
 */
import express from "express"
import EventEmitter from "node:events"
import multer from "multer"
import { expressQueryToRecord, staticContentTypes } from "./serverUtilities.mts"
import { MissingFileQueryError, QueryError } from "./error.mts"
import {
  execute,
  maybeAtLeastEmptyStringParameterValue,
  maybeStringParameterValue,
  narrowStringToCommand,
  setEachParameterWithSource,
  setParameterWithSource,
  Status,
  stringParameterValue,
  type ParameterValue,
} from "./engine.mts"
import debug from "debug"
import { configuredFiles } from "./configuration.mts"
import { type FileCache } from "./fileCache.mts"
import { contentType } from "mime-types"
import { randomUUID } from "node:crypto"
const log = debug("server:server")
const upload = multer()

export const createServer = async ({
  port,
  fileCache,
}: {
  port: number
  fileCache: FileCache
}) => {
  // Create an event emitter to handle cross-cutting communications
  const emitter = new EventEmitter()

  // Only be warned if the number of listeners for a specific event goes above
  // this number. The warning will come in logs (MaxListenersExceededWarning)
  emitter.setMaxListeners(100)

  const app = express()
  const baseURL = `localhost:${port}`

  app.use(express.urlencoded({ extended: true }))
  app.use(upload.none())

  app.use("/", async (req, res, _next) => {
    // Silly chrome dev tools stuff is noisy
    if (req.path.match(/\.well-known\/appspecific\/com.chrome/)) return
    // Req.query is immutable
    let query = expressQueryToRecord(req.query)
    const parameters: ParameterValue = {}
    setEachParameterWithSource(parameters, query, "query param")
    setEachParameterWithSource(parameters, req.body ?? {}, "request body")

    let command = narrowStringToCommand(query.command)

    // Next, try to derive the command from the method or query parameters
    if (command === undefined) {
      if (req.method === "GET") {
        command = "read"
      } else if (req.method === "POST") {
        // Since we want to support basic HTML which only have GET and
        // POST to work with without JS, overload POST and look for
        // another hint as to what to do
        if (query.edit !== undefined) {
          command = "update"
        } else if (query.delete !== undefined) {
          command = "delete"
        } else if (query.create !== undefined) {
          command = "create"
        } else if (req.path === configuredFiles.sharedContentReceiver) {
          // TODO: I don't see any other way to match the specific
          // share content receiver for sure other than the exact path given
          // but this is opposed to the general concept that the path is
          // free for users to target particular entries.
          command = "read"

          setEachParameterWithSource(
            parameters,
            {
              contentPathOrContentTitle: req.path,
            },
            "derived",
          )
        } else {
          // The most RESTful
          command = "update"
        }
      } else if (req.method === "PUT") {
        command = "create"
      } else if (req.method === "DELETE") {
        command = "delete"
        setParameterWithSource(parameters, "delete-confirm", "true", "derived")
      }
    }

    if (command === undefined) {
      throw new Error(
        `Unable to derive command from method '${req.method}' and query string`,
      )
    }

    setParameterWithSource(parameters, "command", command, "derived")

    if (
      stringParameterValue(parameters, "command") == "read" &&
      maybeAtLeastEmptyStringParameterValue(parameters, "edit")
    ) {
      const target =
        maybeStringParameterValue(parameters, "contentPathOrContentTitle") ||
        req.path
      const fileExistsResult = fileCache.getByContentPathOrContentTitle(target)
      // File not existing at all is handled in the engine
      if (fileExistsResult && fileCache.isCoreFile(fileExistsResult)) {
        // If requesting to edit a core file, prompt to create shadow first
        setParameterWithSource(parameters, "target", target, "derived")

        setEachParameterWithSource(
          parameters,
          {
            contentPath: configuredFiles.defaultCreateShadowTemplateFile,
            target: target,
          },
          "derived",
        )
      } else if (fileExistsResult) {
        setEachParameterWithSource(
          parameters,
          {
            target: fileExistsResult.contentPath,
            contentPath: configuredFiles.defaultEditTemplateFile,
          },
          "derived",
        )
      } else {
        throw new MissingFileQueryError(target)
      }
    } else if (
      stringParameterValue(parameters, "command") == "delete" &&
      !maybeAtLeastEmptyStringParameterValue(parameters, "delete-confirm")
    ) {
      res.status(400)
      setParameterWithSource(parameters, "command", "read", "derived")
      command = "read"
      const toDeleteContentPath =
        maybeStringParameterValue(parameters, "contentPathOrContentTitle") ||
        req.path
      const fileExistsResult =
        fileCache.getByContentPathOrContentTitle(toDeleteContentPath)
      if (fileExistsResult && fileCache.isCoreFile(fileExistsResult)) {
        throw new Error(
          `Can't delete core file ${fileExistsResult.contentPath}`,
        )
      } else if (fileExistsResult) {
        setEachParameterWithSource(
          parameters,
          {
            target: fileExistsResult.contentPath,
            contentPath: configuredFiles.defaultDeleteTemplateFile,
          },
          "derived",
        )
      } else {
        throw new MissingFileQueryError(toDeleteContentPath)
      }
    }

    if (
      (command == "update" || command == "create" || command == "delete") &&
      !maybeStringParameterValue(parameters, "contentPathOrContentTitle")
    ) {
      setParameterWithSource(
        parameters,
        "contentPathOrContentTitle",
        req.path,
        "derived",
      )
    }

    if (
      !maybeStringParameterValue(parameters, "contentPathOrContentTitle") &&
      !maybeStringParameterValue(parameters, "contentPath")
    ) {
      if (
        command === "read" &&
        fileCache.getByContentPath(req.path)?.renderability === "static"
      ) {
        log("Serving static file %s", req.path)
        const readResults = fileCache.ensureByContentPath(
          req.path,
        ).originalContent
        res.setHeader(
          "Content-Type",
          contentType(req.path.match(/\.[^.]+$/)![0]) ||
            staticContentTypes.arbitraryFile,
        )
        res.send(readResults.buffer)
        return
      }

      setEachParameterWithSource(
        parameters,
        {
          contentPathOrContentTitle: req.path,
        },
        "derived",
      )
    }

    const result = await execute({ parameters, fileCache })
    if (command === "read" || result.status !== Status.OK) {
      res.setHeader("Content-Type", result.contentType)
      // Only write the status if the result is explicitly not ok
      // because we might have already set it (e.g. delete w/o confirm above)
      if (result.status !== Status.OK) res.status(result.status)
      res.send(result.content)
    } else if (
      command == "update" ||
      command == "create" ||
      command === "delete"
    ) {
      const toWhere =
        maybeStringParameterValue(parameters, "redirect") !== undefined
          ? stringParameterValue(parameters, "redirect")
          : command === "delete"
            ? "/"
            : result.contentPath || "/"
      const params = result.content ? `statusMessage=${result.content}` : ""
      res.redirect(
        `${toWhere}${toWhere.indexOf("?") === -1 ? "?" : "&"}${params}`,
      )
    } else {
      log(
        "Didn't determine what to do with result %o from parameters %O",
        result,
        parameters,
      )
      throw new Error("Unexpected state")
    }
  })

  //
  // Final 404/5XX handlers
  //
  // NOTE: Annoyingly, this error catcher in Express relies on the number of
  //       parameters defined. So you can't remove any of these parameters
  app.use(async function (
    error: unknown,
    req: express.Request,
    res: express.Response,
    _next: () => void,
  ) {
    const parameters: ParameterValue = {
      command: "read",
      originalPath: decodeURIComponent(req.path),
    }

    if (error instanceof QueryError) {
      res.status(error.status)
      parameters.originalError = error.originalError
      parameters.statusCode = error.status
      if (error instanceof MissingFileQueryError) {
        log(`404: While processing request '${req.path}', ${error.message}`)
        parameters.missingPath = error.missingPath
        parameters.contentPath = configuredFiles.fileMissingPageTemplate
      } else {
        log(`QueryError on ${req.path}:`, error)
        parameters.errorUuid = randomUUID()
        parameters.contentPath = configuredFiles.unknownErrorOccurredTemplate
        parameters.errorMessage = error.message
      }
    } else {
      log("5XX", { err: error })
      parameters.errorUuid = randomUUID()
      parameters.contentPath = configuredFiles.unknownErrorOccurredTemplate
      parameters.statusCode = 500
      res.status(500)
    }

    if (parameters.errorUuid) console.log(`Error UUID: ${parameters.errorUuid}`)
    try {
      const result = await execute({
        parameters,
        fileCache,
      })
      res.send(result.content)
    } catch (executeErrorPageError) {
      console.log("Executing error page error: ", executeErrorPageError)
      res.send(
        `500 Something went seriously wrong :-/${parameters.errorUuid ? ` Error UUID: ${parameters.errorUuid}` : ""}`,
      )
    }
    return
  })

  const listener = app.listen(port, (error) => {
    if (error) {
      if ("code" in error && error.code === "EADDRINUSE") {
        log("Port in use, exiting")
        process.exit(1)
      }
      log("Error when starting to listen:", error)
      process.exit(1)
    }
    log(`Server is available at http://${baseURL}`)
  })

  emitter.on("cleanup", () => {
    listener.close(() => {})
  })
  return { cleanup: () => emitter.emit("cleanup") }
}

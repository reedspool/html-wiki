/**
 * Main JS Server
 *
 * Code comments are sparse, but you're welcome to add them as you learn about
 * the system and make a PR!
 */
import express from "express"
import EventEmitter from "node:events"
import multer from "multer"
import {
  expressQueryToRecord,
  staticContentTypes,
  urlSearchParamsToRecord,
} from "./serverUtilities.mts"
import { MissingFileQueryError, QueryError } from "./error.mts"
import {
  contentPathOrContentTitleToContentPath,
  execute,
  maybeAtLeastEmptyStringParameterValue,
  maybeStringParameterValue,
  narrowStringToCommand,
  setEachParameterWithSource,
  setParameterChildrenWithSource,
  setParameterWithSource,
  stringParameterValue,
  type ParameterValue,
} from "./engine.mts"
import debug from "debug"
import { configuredFiles } from "./configuration.mts"
import { buildCache } from "./fileCache.mts"
import { contentType } from "mime-types"
import Watcher from "watcher"
import { randomUUID } from "node:crypto"
const log = debug("server:server")
const upload = multer()

export const createServer = async ({
  port,
  coreDirectory,
  userDirectory,
}: {
  port: number
  coreDirectory: string
  userDirectory: string
}) => {
  // Create an event emitter to handle cross-cutting communications
  const emitter = new EventEmitter()

  // Only be warned if the number of listeners for a specific event goes above
  // this number. The warning will come in logs (MaxListenersExceededWarning)
  emitter.setMaxListeners(100)

  const fileCache = await buildCache({
    searchDirectories: [userDirectory, coreDirectory],
  })

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
          if (query["delete-confirm"] !== undefined) {
            command = "delete"
          } else {
            command = "read"
            res.status(400)
          }
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
              select: "body",
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
        if (query["delete-confirm"] !== undefined) {
          command = "delete"
        } else {
          command = "read"
          res.status(400)
        }
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
      const toEditContentPath =
        maybeStringParameterValue(parameters, "contentPathOrContentTitle") ||
        req.path === "/"
          ? "/index.html"
          : req.path
      const fileExistsResult =
        fileCache.getByContentPathOrContentTitle(toEditContentPath)
      // File not existing at all is handled in the engine
      if (
        fileExistsResult &&
        fileExistsResult.originalContent.foundInDirectory == coreDirectory
      ) {
        // If requesting to edit a core file, prompt to create shadow first
        setParameterWithSource(
          parameters,
          "editContentPath",
          toEditContentPath,
          "derived",
        )

        setEachParameterWithSource(
          parameters,
          {
            select: "body",
            contentPath: configuredFiles.defaultCreateShadowTemplateFile,
            editContentPath: toEditContentPath,
          },
          "derived",
        )
      } else if (fileExistsResult) {
        setEachParameterWithSource(
          parameters,
          {
            editingContentPath: fileExistsResult.contentPath,
            contentPath: configuredFiles.defaultEditTemplateFile,
            select: "body",
          },
          "derived",
        )
      } else {
        throw new MissingFileQueryError(toEditContentPath)
      }
    } else if (
      stringParameterValue(parameters, "command") == "read" &&
      maybeAtLeastEmptyStringParameterValue(parameters, "delete")
    ) {
      const toDeleteContentPath =
        maybeStringParameterValue(parameters, "contentPathOrContentTitle") ||
        req.path
      const fileExistsResult =
        fileCache.getByContentPathOrContentTitle(toDeleteContentPath)
      if (
        fileExistsResult &&
        fileExistsResult.originalContent.foundInDirectory == coreDirectory
      ) {
        throw new Error(
          `Can't delete core file ${fileExistsResult.contentPath}`,
        )
      } else if (fileExistsResult) {
        setEachParameterWithSource(
          parameters,
          {
            deletingContentPath: fileExistsResult.contentPath,
            contentPath: configuredFiles.defaultDeleteTemplateFile,
            select: "body",
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
        const readResults = await fileCache.readFileRaw(req.path)
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
          select: "body",
          contentPathOrContentTitle: req.path,
        },
        "derived",
      )
    }

    const result = await execute({ parameters, fileCache })
    if (command === "read") {
      res.setHeader("Content-Type", result.contentType)
      // TODO: This is silly because it's like the one instance where I'm not
      // looking at the contentPathOrContentTitle and instead looking only at the path.
      // Suggests this is somethign the Engine should be doing instead?
      if (req.path === configuredFiles.fileMissingPageTemplate) {
        res.status(404)
      }
      res.send(result.content)
    } else if (
      maybeStringParameterValue(parameters, "redirect") !== undefined
    ) {
      res.redirect(stringParameterValue(parameters, "redirect"))
    } else if (command == "update" || command == "create") {
      res.redirect(
        `${result.contentPath || "/"}?statusMessage=${result.content}`,
      )
    } else if (command == "delete") {
      res.redirect(`/?statusMessage=${result.content}`)
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
      select: "body",
      originalPath: decodeURIComponent(req.path),
    }

    if (error instanceof QueryError) {
      res.status(error.status)
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

  app.use(function (req, res) {
    res.status(404)
    // If the path is already the 404 page, then don't redirect as that would be infinite
    if (req.path === configuredFiles.fileMissingPageTemplate) {
      res.write(`404 - File Not Found`)
      res.setHeader("Content-Type", staticContentTypes.plainText)
      res.end()
      return
    }

    // Otherwise, redirect to the 404 page but given this
    res.redirect(
      `${configuredFiles.fileMissingPageTemplate}?originalPath=${req.path}`,
    )
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

  const watcher = new Watcher([userDirectory, coreDirectory], {
    recursive: true,
    ignoreInitial: true,
  })
  watcher.on(
    "all",
    (event: string, targetPath: string, targetPathNext: string) => {
      // TODO: Maybe should allow the watcher to do the initial scan?
      const directory = targetPath.startsWith(userDirectory)
        ? userDirectory
        : coreDirectory
      const contentPath = targetPath.slice(directory.length)
      log("Watcher event: %o", {
        event,
        targetPath,
        targetPathNext,
        directory,
        contentPath,
      })
      switch (event) {
        case "add":
          fileCache.addFileToCacheData({
            contentPath,
          })
          break
        case "unlink":
          // TODO: Just realized I don't have any way to not do this when
          // the server internals cause these changes. i initially added this
          // file watcher for editing based on outside edits, but duh it happens
          // always. So if those are occurring, then this is doubled.
          // I don't understand why this doesn't occur in my integration tests...
          // True for add and change but this is more problematic could result in removing a shadowed version
          fileCache.removeFileFromCacheData({
            contentPath,
          })
          break
        case "change":
          fileCache.addFileToCacheData({
            contentPath,
          })
          break
        default:
          log("Watcher unhandled event: %o", {
            event,
            targetPath,
            targetPathNext,
          })
      }
    },
  )

  return { cleanup: () => emitter.emit("cleanup") }
}

// Catch and snuff all uncaught exceptions and uncaught promise rejections.
// We can manually restart the server if it gets into a bad state, but we want

import Watcher from "watcher"
import { normalize } from "path"
import { createServer } from "./server.mts"
import { Command } from "@commander-js/extra-typings"
import {
  execute,
  type ParameterValue,
  setEachParameterWithSource,
} from "./engine.mts"
import debug from "debug"
import { configuredFiles } from "./configuration.mts"
import { buildCache, type FileCache } from "./fileCache.mts"
import { removeFile } from "./filesystem.mts"
const log = debug("cli:main")

let server: Awaited<ReturnType<typeof createServer>>

// So I can kill from local terminal with Ctrl-c
// From https://github.com/strongloop/node-foreman/issues/118#issuecomment-475902308
process.on("SIGINT", (signal) => {
  log(`Signal ${signal} received, shutting down`)
  server.cleanup()
  // Just wait some amount of time before exiting. Ideally the listener would
  // close successfully, but it seems to hang for some reason.
  setTimeout(() => process.exit(0), 150)
})

const program = new Command().description("HTML Wiki command line tool")
program
  .command("server")
  .description("run web server")
  .option("-c, --core-directory <string>", "where to read core files", "")
  .option("-u, --user-directory <string>", "where to read user files")
  .option("--port <number>")
  .option("--ignore-errors")
  .action(async (options) => {
    log({ options })
    if (!options.coreDirectory) {
      options.coreDirectory = configuredFiles.coreDirectory
      log(`No core directory given, using default ${options.coreDirectory}`)
    }
    if (!options.userDirectory) {
      throw new Error("--user-directory option is required")
    }
    const { userDirectory, coreDirectory } = options
    let port: number
    if (process.env.PORT !== undefined) {
      port = Number(process.env.PORT)
      log(`Using environment variable port ${port}`)
    } else if (options.port !== undefined) {
      port = Number(options.port)
      log(`Using command line option port ${port}`)
    } else {
      port = 3001
      log(`Using default port ${port}`)
    }
    if (options.ignoreErrors) ignoreErrors()
    const searchDirectories = [
      normalize(userDirectory),
      normalize(coreDirectory),
    ]
    const fileCache = await buildCache({
      searchDirectories,
    })
    setupWatcher({ searchDirectories }).on(
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

    server = await createServer({
      port,
      fileCache,
    })
  })

program
  .command("generate")
  .description("render and write out a static version of the site")
  .option("-c, --core-directory <string>", "where to read core files", "")
  .option("-u, --user-directory <string>", "where to read user files")
  .option("-o, --out-directory <string>", "where to write files", "./build")
  .option("-w, --watch", "watch source files and rebuild", false)
  .action(async (options) => {
    log(options)
    if (!options.coreDirectory) {
      options.coreDirectory = configuredFiles.coreDirectory
      log(`No core directory given, using default ${options.coreDirectory}`)
    }
    if (!options.userDirectory) {
      throw new Error("--user-directory option is required")
    }

    if (
      normalize(options.coreDirectory) === normalize(options.outDirectory) ||
      normalize(options.userDirectory) === normalize(options.outDirectory)
    ) {
      log(
        "You probaby didn't want to write out exactly where you're reading from",
      )
      process.exit(1)
    }
    const { coreDirectory, userDirectory, outDirectory } = options
    const searchDirectories = [userDirectory, coreDirectory]
    const sourceFileCache = await buildCache({
      searchDirectories,
    })
    const destinationFileCache = await buildCache({
      searchDirectories: [outDirectory],
    })
    const files = (await sourceFileCache.getListOfFilesAndDetails()).map(
      ({ contentPath }) => contentPath,
    )

    log(`Writing files to ${outDirectory}:`, "\n" + files.join("\n"))
    log(`Using default page template '${configuredFiles.defaultPageTemplate}'`)
    const writeFile = async (contentPath: string) => {
      const readParameters: ParameterValue = {}
      setEachParameterWithSource(
        readParameters,
        {
          contentPath: contentPath,
          command: "read",
        },
        "query param",
      )
      let outputPath = contentPath
      let outputContent: Buffer | string
      const { renderability } = sourceFileCache.getByContentPath(contentPath)!
      switch (renderability) {
        case "static":
          outputContent =
            sourceFileCache.getByContentPath(contentPath)?.originalContent
              .buffer!
          break
        case "html":
        case "markdown":
          const readResult = await execute({
            parameters: readParameters,
            fileCache: sourceFileCache,
          })
          outputContent = readResult.content
          if (renderability === "markdown")
            outputPath = outputPath.replace(/\.md$/, ".html")
          break
        default:
          const _exhaustiveCheck: never = renderability
          throw new Error(`Renderability unaccounted for: ${_exhaustiveCheck}`)
      }

      const writeParameters: ParameterValue = {}
      setEachParameterWithSource(
        writeParameters,
        {
          contentPath: outputPath,
          content: outputContent,
          command: "create",
        },
        "query param",
      )
      await execute({
        parameters: writeParameters,
        fileCache: destinationFileCache,
      })
    }
    const fileWritingPromises = files.map(writeFile)

    await Promise.all(fileWritingPromises)

    if (options.watch) {
      searchDirectories.forEach((dir) =>
        console.log(`Watching files in ${normalize(dir)}`),
      )
      setupWatcher({ searchDirectories }).on(
        "all",
        async (event: string, targetPath: string, targetPathNext: string) => {
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
              await sourceFileCache.addFileToCacheData({
                contentPath,
              })
              await writeFile(contentPath)
              break
            case "unlink":
              // TODO: Just realized I don't have any way to not do this when
              // the server internals cause these changes. i initially added this
              // file watcher for editing based on outside edits, but duh it happens
              // always. So if those are occurring, then this is doubled.
              // I don't understand why this doesn't occur in my integration tests...
              // True for add and change but this is more problematic could result in removing a shadowed version
              await execute({
                fileCache: sourceFileCache,
                parameters: {
                  command: "delete",
                  contentPath,
                },
              })
              await execute({
                fileCache: destinationFileCache,
                parameters: {
                  command: "delete",
                  contentPath,
                },
              })

              // If shadow was uncovered
              if (sourceFileCache.getByContentPath(contentPath)) {
                await writeFile(contentPath)
              }
              break
            case "change":
              // TODO: Engine "update" command takes the new content as parametre and writes the file,
              // maybe server should do that and then this could be execute "update"
              await sourceFileCache.removeFileFromCacheData({ contentPath })
              await sourceFileCache.addFileToCacheData({ contentPath })

              await execute({
                fileCache: destinationFileCache,
                parameters: {
                  command: "delete",
                  contentPath,
                },
              })

              writeFile(contentPath)
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
    }
  })

program.parse()

function ignoreErrors() {
  process.on("uncaughtException", function (err) {
    log("Top-level uncaught exception: " + err, err)
  })
  process.on("unhandledRejection", function (err, promise) {
    log(
      "Top level unhandled rejection (promise: ",
      promise,
      ", reason: ",
      err,
      ").",
      err,
    )
  })
}

const setupWatcher = ({
  searchDirectories,
}: {
  searchDirectories: Array<string>
}) =>
  new Watcher(searchDirectories, {
    recursive: true,
    ignoreInitial: true,
  })

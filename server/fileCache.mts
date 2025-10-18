import { basename } from "node:path"
import { parse as parseHtml } from "node-html-parser"
import { applyTemplating, type Meta } from "./dom.mts"
import {
  createFileAndDirectories,
  fileExists,
  listAndMergeAllDirectoryContents,
  type MyDirectoryEntry,
  readFile,
  readFileRaw,
  type ReadResults,
  removeFile,
  updateFile,
} from "./filesystem.mts"
import debug from "debug"
import { MissingFileQueryError } from "./error.mts"
import { renderMarkdown } from "./utilities.mts"
const log = debug("server:fileCache")

export type FileContentsAndDetails = {
  meta: Meta
  originalContent: { content: string; foundInDirectory: string; buffer: Buffer }
  renderability: Renderability
} & MyDirectoryEntry

export type FileCache = {
  listOfFilesAndDetails: Array<FileContentsAndDetails>
  getByContentPath: (path: string) => FileContentsAndDetails | undefined
  getByTitle: (title: string) => FileContentsAndDetails | undefined
  getByContentPathOrContentTitle: (
    pathOrTitle: string,
  ) => FileContentsAndDetails | undefined
  readFile: (path: string) => ReturnType<typeof readFile>
  readFileRaw: (path: string) => ReturnType<typeof readFileRaw>
  fileExists: (path: string) => ReturnType<typeof fileExists>
  createFileAndDirectories: (params: {
    contentPath: string
    content: string
  }) => ReturnType<typeof createFileAndDirectories>
  updateFile: (params: {
    contentPath: string
    content: string
  }) => ReturnType<typeof updateFile>
  removeFile: (params: { contentPath: string }) => ReturnType<typeof removeFile>
}

export const buildEmptyCache = async (): ReturnType<typeof buildCache> => {
  return {
    listOfFilesAndDetails: [],
    getByTitle: () => undefined,
    getByContentPath: () => undefined,
    getByContentPathOrContentTitle: () => undefined,
    readFile: () => {
      throw new Error("No files exist in empty cache")
    },
    readFileRaw: () => {
      throw new Error("No files exist in empty cache")
    },
    fileExists: async () => ({ exists: false }),
    createFileAndDirectories: () => {
      throw new Error("Cannot create anything in empty cache")
    },
    updateFile: () => {
      throw new Error("Cannot update anything in empty cache")
    },
    removeFile: () => {
      throw new Error("Cannot remove anything in empty cache")
    },
  }
}

export const buildCache = async ({
  searchDirectories,
}: {
  searchDirectories: string[]
}): Promise<FileCache> => {
  if (searchDirectories.length === 0) {
    throw new Error("Cache requires non-empty searchDirectories upfront")
  }
  let listOfFilesAndDetails: FileContentsAndDetails[] = []
  const filesByTitle: Record<string, FileContentsAndDetails> = {}
  const filesByContentPath: Record<string, FileContentsAndDetails> = {}
  const addFileToCacheData = (everything: FileContentsAndDetails) => {
    listOfFilesAndDetails.push(everything)
    filesByContentPath[everything.contentPath] = everything

    if (typeof everything.meta.title === "string") {
      filesByTitle[everything.meta.title] = everything
    } else if (everything.meta.title) {
      log(`Title must be a string, got %o`, everything.meta.title)
      throw new Error(`Title must be a string, see log`)
    }
  }
  const removeFileFromCacheData = async (contentPath: string) => {
    listOfFilesAndDetails = listOfFilesAndDetails.filter(
      ({ contentPath }) => contentPath !== contentPath,
    )
    const detail = filesByContentPath[contentPath]
    delete filesByContentPath[contentPath]
    if (typeof detail.meta.title === "string")
      delete filesByTitle[detail.meta.title]

    // Find if there's a revealed shadow file
    const existsResults = await fileExists({ contentPath, searchDirectories })
    if (existsResults.exists) {
      const templateResults = await getFileContentsAndMetadata({
        contentPath,
        searchDirectories,
        fileCache,
      })
      addFileToCacheData({
        name: basename(contentPath),
        type: "file",
        contentPath,
        ...templateResults,
      })
    }
  }
  const allFiles = await getContentsAndMetaOfAllFiles({
    // TODO: To recover from race conditions on initial build,
    // in the future, probably want to be able to start with the last cache.
    // Except that wouldn't account for deletions? Unless that was repaired first?
    fileCache: await buildEmptyCache(),
    searchDirectories,
  })

  allFiles.forEach(addFileToCacheData)

  const fileCache: FileCache = {
    listOfFilesAndDetails,
    getByContentPath: (path) => filesByContentPath[path],
    getByTitle: (title) => filesByTitle[title],
    getByContentPathOrContentTitle: (pathOrTitle) => {
      return pathOrTitle === "/"
        ? filesByContentPath["/index.html"]
        : (filesByTitle[decodeURIComponent(pathOrTitle).replace(/^\//, "")] ??
            filesByContentPath[pathOrTitle])
    },
    readFile: async (path) => {
      const entry = filesByContentPath[path]
      if (!entry) {
        throw new MissingFileQueryError(path)
      }
      return entry.originalContent
    },
    readFileRaw: async (path) => {
      const entry = filesByContentPath[path]
      if (!entry) {
        throw new MissingFileQueryError(path)
      }
      return entry.originalContent
    },
    fileExists: async (path) =>
      filesByContentPath[path]
        ? { exists: true, ...filesByContentPath[path].originalContent }
        : { exists: false },
    createFileAndDirectories: async ({ contentPath, content }) => {
      const result = await createFileAndDirectories({
        directory: searchDirectories.at(0)!,
        contentPath,
        content,
      })

      const details: FileContentsAndDetails = await resolveDirEntToAllStuff({
        dirent: {
          name: basename(contentPath),
          contentPath,
          type: "file",
        },
        fileCache,
        searchDirectories,
      })

      // TODO: Hm this isn't technically wrong with the constraints of
      // shadowing.  That is, this file could be called to create a directory
      // deeper in the  stack of shadows, and maybe there's still a file higher
      // up that should shadow it. So maybe we shouldn't always be adding it
      // to these structures
      addFileToCacheData(details)

      return result
    },

    updateFile: async ({ contentPath, content }) => {
      const directory = searchDirectories.at(0)!
      const result = await updateFile({
        directory,
        contentPath,
        content,
      })
      await removeFileFromCacheData(contentPath)
      const templateResults = await getFileContentsAndMetadata({
        contentPath,
        searchDirectories,
        fileCache,
      })
      addFileToCacheData({
        name: basename(contentPath),
        type: "file",
        contentPath,
        ...templateResults,
      })
      return result
    },
    removeFile: async ({ contentPath }) => {
      const directory = searchDirectories.at(0)!
      const existingEntry = filesByContentPath[contentPath]
      if (!existingEntry) {
        throw new MissingFileQueryError(contentPath)
      }
      if (existingEntry.originalContent.foundInDirectory !== directory) {
        throw new Error(
          "Can only delete files in the top-level search directory",
        )
      }
      // Don't update the cache until the operation is successful
      const result = await removeFile({ directory, contentPath })
      await removeFileFromCacheData(contentPath)
      return result
    },
  }

  return fileCache
}

export type Renderability = "html" | "markdown" | "static"
const getFileContentsAndMetadata = async ({
  contentPath,
  searchDirectories,
  fileCache,
}: {
  fileCache: FileCache
  contentPath: string
  searchDirectories: string[]
}): Promise<{
  originalContent: ReadResults
  meta: Meta
  renderability: Renderability
}> => {
  const readResults = await readFile({
    searchDirectories,
    contentPath,
  })
  if (/\.html$/.test(contentPath)) {
    try {
      const result = await applyTemplating({
        fileCache,
        content: readResults.content,
        parameters: {},
        topLevelParameters: {},
        stopAtSelector: "body",
      })
      return {
        ...result,
        originalContent: readResults,
        renderability: "html",
      }
    } catch (error) {
      throw new Error(
        `Couldn't apply templating for '${contentPath}': ${error}`,
      )
    }
  } else if (/\.md$/.test(contentPath)) {
    try {
      const meta: Meta = {}
      const markdownContent = renderMarkdown(readResults.content)
      const root = parseHtml(markdownContent)
      const h1 = root.querySelector("h1")
      if (h1) {
        meta.title = h1.innerText
      }
      return {
        meta,
        originalContent: readResults,
        renderability: "markdown",
      }
    } catch (error) {
      throw new Error(
        `Couldn't apply templating for '${contentPath}': ${error}`,
      )
    }
  } else {
    return { originalContent: readResults, meta: {}, renderability: "static" }
  }
}

const getContentsAndMetaOfAllFiles = async ({
  searchDirectories,
  fileCache,
}: {
  searchDirectories: string[]
  fileCache: FileCache
}): Promise<Array<FileContentsAndDetails>> => {
  const allDirents = await listAndMergeAllDirectoryContents({
    searchDirectories,
  })
  return Promise.all(
    allDirents
      .filter(({ type }) => type === "file")
      .map((dirent) =>
        resolveDirEntToAllStuff({
          dirent,
          fileCache,
          searchDirectories,
        }),
      ),
  )
}

export const resolveDirEntToAllStuff = async ({
  dirent,
  fileCache,
  searchDirectories,
}: {
  dirent: MyDirectoryEntry
  fileCache: FileCache
  searchDirectories: string[]
}) => {
  const templateResults = await getFileContentsAndMetadata({
    fileCache,
    contentPath: dirent.contentPath,
    searchDirectories,
  })
  return {
    ...dirent,
    type: "file",
    ...templateResults,
  } as const
}

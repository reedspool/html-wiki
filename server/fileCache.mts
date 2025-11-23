import { basename } from "node:path"
import { parse as parseHtml } from "node-html-parser"
import { applyTemplating, type Meta } from "./dom.mts"
import {
  createFileAndDirectories,
  fileExists,
  filePath,
  listAndMergeAllDirectoryContents,
  type MyDirectoryEntry,
  readFile,
  readFileRaw,
  type ReadResults,
  removeFile,
  stat,
  updateFile,
} from "./filesystem.mts"
import debug from "debug"
import { MissingFileQueryError } from "./error.mts"
import { parseFrontmatter, renderMarkdown } from "./utilities.mts"
const log = debug("server:fileCache")
type FileContentsAndMetaData = {
  originalContent: ReadResults
  meta: Meta
  renderability: Renderability
  accessTimeMs: number
  createdTimeMs: number
  modifiedTimeMs: number
  links: Array<string>
}
export type FileContentsAndDetails = FileContentsAndMetaData & MyDirectoryEntry

export type FileCache = {
  rebuildMetaCache: () => Promise<void>
  addFileToCacheData: (params: {
    contentPath: string
    rebuildMetaCache?: boolean
  }) => Promise<void>
  removeFileFromCacheData: (params: { contentPath: string }) => Promise<void>
  getListOfFilesAndDetails: () => Promise<Array<FileContentsAndDetails>>
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
  getBacklinksByContentPath: (path: string) => Promise<Array<string>>
  getContentPathsForKeyword: (keyword: string) => Promise<Array<string>>
  allKeywords: () => Promise<Array<string>>
}

export const buildEmptyCache = async (): ReturnType<typeof buildCache> => {
  return createFreshCache({ searchDirectories: [] })
}

export const createFreshCache = async ({
  searchDirectories,
}: {
  searchDirectories: string[]
}): Promise<FileCache> => {
  let listOfFilesAndDetails: FileContentsAndDetails[] = []
  const filesByTitle: Record<string, FileContentsAndDetails> = {}
  const filesByContentPath: Record<string, FileContentsAndDetails> = {}
  const addFileToCacheData: FileCache["addFileToCacheData"] = async ({
    contentPath,
    rebuildMetaCache = true,
  }) => {
    const everything: FileContentsAndDetails = {
      contentPath,
      name: basename(contentPath),
      type: "file",
      ...(await getFileContentsAndMetadata({
        fileCache,
        contentPath,
        searchDirectories,
      })),
    }

    listOfFilesAndDetails = listOfFilesAndDetails.filter(
      ({ contentPath }) => everything.contentPath !== contentPath,
    )
    listOfFilesAndDetails.push(everything)
    filesByContentPath[everything.contentPath] = everything

    if (rebuildMetaCache) await fileCache.rebuildMetaCache()

    if (typeof everything.meta.title === "string") {
      filesByTitle[everything.meta.title] = everything
    } else if (everything.meta.title) {
      log(`Title must be a string, got %o`, everything.meta.title)
      throw new Error(`Title must be a string, see log`)
    }
  }
  const removeFileFromCacheData: FileCache["removeFileFromCacheData"] = async ({
    contentPath,
  }) => {
    listOfFilesAndDetails = listOfFilesAndDetails.filter(
      ({ contentPath: path }) => path !== contentPath,
    )
    const detail = filesByContentPath[contentPath]
    delete filesByContentPath[contentPath]
    if (typeof detail.meta.title === "string")
      delete filesByTitle[detail.meta.title]

    // Find if there's a revealed shadow file
    const existsResults = await fileExists({ contentPath, searchDirectories })
    if (existsResults.exists) {
      await addFileToCacheData({ contentPath })
    }
  }

  const getListOfFilesAndDetails = async () => [...listOfFilesAndDetails]

  let backLinksByContentPath: Record<string, Array<string>> = {}
  let keywordsToContentPaths: Record<string, Array<string>> = {}
  const getBacklinksByContentPath: (
    path: string,
  ) => Promise<Array<string>> = async (path) => {
    const backlinks = backLinksByContentPath[path]
    if (!backlinks) return []
    return [...backlinks]
  }

  const getContentPathsForKeyword: (
    keyword: string,
  ) => Promise<(typeof keywordsToContentPaths)[string]> = async (keyword) => {
    const paths = keywordsToContentPaths[keyword]
    if (!paths) return []
    return [...paths]
  }
  const allKeywords = async () => Object.keys(keywordsToContentPaths)
  const rebuildMetaCache: FileCache["rebuildMetaCache"] = async () => {
    keywordsToContentPaths = {}
    backLinksByContentPath = {}
    for (const {
      contentPath: sourceContentPath,
      links,
      meta: { keywords },
    } of await getListOfFilesAndDetails()) {
      for (const keyword of keywords ?? []) {
        if (!keywordsToContentPaths[keyword])
          keywordsToContentPaths[keyword] = []
        keywordsToContentPaths[keyword].push(sourceContentPath)
      }
      for (const link of links) {
        const byTitle = fileCache.getByContentPathOrContentTitle(link)
        const destinationContentPath = byTitle ? byTitle.contentPath : link
        if (!backLinksByContentPath[destinationContentPath])
          backLinksByContentPath[destinationContentPath] = []
        backLinksByContentPath[destinationContentPath].push(sourceContentPath)
      }
    }
  }

  const fileCache: FileCache = {
    rebuildMetaCache,
    getListOfFilesAndDetails,
    getContentPathsForKeyword,
    getBacklinksByContentPath,
    allKeywords,
    addFileToCacheData,
    removeFileFromCacheData,
    getByContentPath: (path) => filesByContentPath[decodeURIComponent(path)],
    getByTitle: (title) => filesByTitle[decodeURIComponent(title)],
    getByContentPathOrContentTitle: (pathOrTitle) => {
      return pathOrTitle === "/"
        ? filesByContentPath["/index.html"]
        : (filesByTitle[decodeURIComponent(pathOrTitle).replace(/^\//, "")] ??
            filesByContentPath[decodeURIComponent(pathOrTitle)])
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

      // TODO: Hm this isn't technically wrong with the constraints of
      // shadowing.  That is, this file could be called to create a directory
      // deeper in the  stack of shadows, and maybe there's still a file higher
      // up that should shadow it. So maybe we shouldn't always be adding it
      // to these structures
      await addFileToCacheData({ contentPath })

      return result
    },

    updateFile: async ({ contentPath, content }) => {
      const directory = searchDirectories.at(0)!
      const result = await updateFile({
        directory,
        contentPath,
        content,
      })
      await removeFileFromCacheData({ contentPath })
      await addFileToCacheData({ contentPath })
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
      await removeFileFromCacheData({ contentPath })
      return result
    },
  }
  return fileCache
}

export const buildCache = async ({
  searchDirectories,
}: {
  searchDirectories: string[]
}): Promise<FileCache> => {
  if (searchDirectories.length === 0) {
    throw new Error("Cache requires non-empty searchDirectories upfront")
  }
  const fileCache = await createFreshCache({ searchDirectories })
  const allFiles = await getContentsAndMetaOfAllFiles({
    // TODO: To recover from race conditions on initial build,
    // in the future, probably want to be able to start with the last cache.
    // Except that wouldn't account for deletions? Unless that was repaired first?
    fileCache: await buildEmptyCache(),
    searchDirectories,
  })

  await Promise.all(
    allFiles.map(({ contentPath }) =>
      fileCache.addFileToCacheData({ contentPath, rebuildMetaCache: false }),
    ),
  )

  await fileCache.rebuildMetaCache()

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
}): Promise<FileContentsAndMetaData> => {
  const readResults = await readFile({
    searchDirectories,
    contentPath,
  })
  const stats = await stat(
    filePath({ contentPath, directory: readResults.foundInDirectory }),
  )
  const myStats = {
    accessTimeMs: stats.atimeMs,
    createdTimeMs: stats.ctimeMs,
    modifiedTimeMs: stats.mtimeMs,
  }
  if (/\.html$/.test(contentPath) && !/\.fragment\.html$/.test(contentPath)) {
    try {
      const result = await applyTemplating({
        fileCache,
        content: readResults.content,
        parameters: {},
        topLevelParameters: {},
        rootSelector: "head",
      })
      return {
        meta: result.meta,
        originalContent: readResults,
        renderability: "html",
        links: result.links,
        ...myStats,
      }
    } catch (error) {
      throw new Error(
        `Couldn't apply templating for '${contentPath}': ${error}`,
      )
    }
  } else if (/\.md$/.test(contentPath)) {
    try {
      const meta: Meta = {}

      const parsedFrontmatter = parseFrontmatter(readResults.content)
      if (parsedFrontmatter.frontmatter) {
        Object.assign(meta, parsedFrontmatter.frontmatter)
      }
      const markdownContent = renderMarkdown(readResults.content)
      const root = parseHtml(markdownContent)
      const h1 = root.querySelector("h1")
      if (!meta.title && h1) {
        meta.title = h1.innerText
      }
      const links: string[] = []
      root.querySelectorAll("a").forEach((a) => {
        const href = a.getAttribute("href")
        if (href) links.push(href)
      })
      return {
        meta,
        originalContent: readResults,
        renderability: "markdown",
        links,
        ...myStats,
      }
    } catch (error) {
      throw new Error(
        `Couldn't apply templating for '${contentPath}': ${error}`,
      )
    }
  } else {
    return {
      originalContent: readResults,
      meta: {},
      renderability: "static",
      links: [],
      ...myStats,
    }
  }
}

const getContentsAndMetaOfAllFiles = async ({
  searchDirectories,
}: {
  searchDirectories: string[]
  fileCache: FileCache
}): Promise<Array<MyDirectoryEntry>> => {
  const allDirents = await listAndMergeAllDirectoryContents({
    searchDirectories,
  })
  return Promise.all(allDirents.filter(({ type }) => type === "file"))
}

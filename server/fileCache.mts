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
import { deepFreeze, parseFrontmatter, renderMarkdown } from "./utilities.mts"
import type { ReadonlyDeep } from "type-fest"
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
  getContentPathsByDirectoryStructure: () => Promise<
    ReadonlyDeep<ContentPathsByDirectoryStructure>
  >
  getByContentPath: (path: string) => FileContentsAndDetails | undefined
  isCoreFile: (fileContentsAndDetails: FileContentsAndDetails) => boolean
  ensureByContentPath: (path: string) => FileContentsAndDetails
  getByTitle: (title: string) => FileContentsAndDetails | undefined
  getByContentPathOrContentTitle: (
    pathOrTitle: string,
  ) => FileContentsAndDetails | undefined
  ensureByContentPathOrContentTitle: (
    pathOrTitle: string,
  ) => FileContentsAndDetails
  fileExists: (path: string) => ReturnType<typeof fileExists>
  createFileAndDirectories: (params: {
    contentPath: string
    content: string | Buffer
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

export type ContentPathsByDirectoryStructureEntry =
  | string
  | { [key in string]: ContentPathsByDirectoryStructureEntry }
export type ContentPathsByDirectoryStructure = Record<
  string,
  ContentPathsByDirectoryStructureEntry
>

export const createFreshCache = async ({
  searchDirectories,
}: {
  searchDirectories: string[]
}): Promise<FileCache> => {
  let listOfFilesAndDetails: FileContentsAndDetails[] = []
  let contentPathsByDirectoryStructure: ReadonlyDeep<ContentPathsByDirectoryStructure> =
    {}
  let backLinksByContentPath: Record<string, Array<string>> = {}
  let keywordsToContentPaths: Record<string, Array<string>> = {}
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
    let contentPathsByDirectoryStructureTmp: ContentPathsByDirectoryStructure =
      {}
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
      // All entries have a leading slash, so discard that, and the end filename
      const directoryStructure = sourceContentPath.split("/").slice(1, -1)
      if (directoryStructure.length < 1) {
        contentPathsByDirectoryStructureTmp[sourceContentPath] =
          sourceContentPath
      } else {
        let currentDirectoryLevel = contentPathsByDirectoryStructureTmp
        for (const directory of directoryStructure) {
          if (directory in currentDirectoryLevel) {
            if (typeof currentDirectoryLevel[directory] === "string") {
              console.error({
                message: "Expected directory to be object",
                directory,
                currentDirectoryLevel,
              })
              throw new Error("Name conflict between directory and filename")
            } else {
              currentDirectoryLevel = currentDirectoryLevel[directory]
            }
          } else {
            currentDirectoryLevel = currentDirectoryLevel[directory] = {}
          }
        }
        currentDirectoryLevel[sourceContentPath] = sourceContentPath
      }
    }

    contentPathsByDirectoryStructure = deepFreeze(
      contentPathsByDirectoryStructureTmp,
    )
  }

  const getContentPathsByDirectoryStructure = async () =>
    contentPathsByDirectoryStructure

  const getByContentPathOrContentTitle: FileCache["getByContentPathOrContentTitle"] =
    (pathOrTitle) => {
      return pathOrTitle === "/"
        ? filesByContentPath["/index.html"]
        : (filesByTitle[decodeURIComponent(pathOrTitle).replace(/^\//, "")] ??
            filesByContentPath[decodeURIComponent(pathOrTitle)] ??
            filesByContentPath[decodeURIComponent(pathOrTitle + "/index.html")])
    }

  const fileCache: FileCache = {
    rebuildMetaCache,
    getListOfFilesAndDetails,
    getContentPathsByDirectoryStructure,
    getContentPathsForKeyword,
    isCoreFile: (fileContentsAndDetails) =>
      fileContentsAndDetails.originalContent.foundInDirectory !==
      searchDirectories.at(0),
    getBacklinksByContentPath,
    allKeywords,
    addFileToCacheData,
    removeFileFromCacheData,
    getByContentPath: (path) => filesByContentPath[decodeURIComponent(path)],
    getByTitle: (title) => filesByTitle[decodeURIComponent(title)],
    getByContentPathOrContentTitle,
    ensureByContentPathOrContentTitle: (path) => {
      const entry = getByContentPathOrContentTitle(path)
      if (!entry) {
        throw new MissingFileQueryError(path)
      }
      return entry
    },
    ensureByContentPath: (path) => {
      const entry = filesByContentPath[decodeURIComponent(path)]
      if (!entry) {
        throw new MissingFileQueryError(path)
      }
      return entry
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
  const isMarkdown = /\.md$/.test(contentPath)
  if (
    isMarkdown ||
    (/\.html$/.test(contentPath) && !/\.fragment\.html$/.test(contentPath))
  ) {
    let content = readResults.content
    const returnVal: FileContentsAndMetaData = {
      meta: {},
      originalContent: readResults,
      renderability: "html",
      links: [],
      ...myStats,
    }
    if (isMarkdown) {
      try {
        returnVal.renderability = "markdown"
        const parsedFrontmatter = parseFrontmatter(content)
        if (parsedFrontmatter.frontmatter) {
          Object.assign(returnVal.meta, parsedFrontmatter.frontmatter)
        }
        const markdownContent = renderMarkdown(content)
        const root = parseHtml(markdownContent)
        const h1 = root.querySelector("h1")
        if (!returnVal.meta.title && h1) {
          returnVal.meta.title = h1.innerText
        }
        root.querySelectorAll("a").forEach((a) => {
          const href = a.getAttribute("href")
          if (href) returnVal.links.push(href)
        })
      } catch (error) {
        throw new Error(
          `Couldn't apply templating for '${contentPath}': ${error}`,
        )
      }
    }

    try {
      const result = await applyTemplating({
        fileCache,
        content: readResults.content,
        parameters: { rootSelector: "head", noselect: true },
      })

      Object.assign(returnVal.meta, result.meta)
      // TODO: This is going to double all the markdown-discovered links :-/ Maybe just don't get links from Markdown?
      returnVal.links.push(...result.links)

      return returnVal
    } catch (error) {
      console.error("Templating error:", error)
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

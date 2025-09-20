import { basename } from "node:path";
import { applyTemplating, type Meta } from "./dom.mts";
import {
  createFileAndDirectories,
  fileExists,
  listAndMergeAllDirectoryContents,
  type MyDirectoryEntry,
  readFile,
  readFileRaw,
  removeFile,
  updateFile,
} from "./filesystem.mts";
import debug from "debug";
const log = debug("server:fileCache");

export type FileContentsAndDetails = {
  meta: Meta;
  originalContent: { content: string; foundInDirectory: string };
} & MyDirectoryEntry;
export type FileCache = {
  listOfFilesAndDetails: Array<FileContentsAndDetails>;
  getByContentPath: (path: string) => FileContentsAndDetails | undefined;
  getByTitle: (title: string) => FileContentsAndDetails | undefined;
  readFile: (path: string) => ReturnType<typeof readFile>;
  readFileRaw: (path: string) => ReturnType<typeof readFileRaw>;
  fileExists: (path: string) => ReturnType<typeof fileExists>;
  createFileAndDirectories: (params: {
    directory: string;
    contentPath: string;
    content: string;
  }) => ReturnType<typeof createFileAndDirectories>;
  updateFile: (params: {
    directory: string;
    contentPath: string;
    content: string;
  }) => ReturnType<typeof updateFile>;
  removeFile: (params: {
    directory: string;
    contentPath: string;
  }) => ReturnType<typeof removeFile>;
};

export const buildEmptyCache = async (): ReturnType<typeof buildCache> => {
  return {
    listOfFilesAndDetails: [],
    getByTitle: () => undefined,
    getByContentPath: () => undefined,
    readFile: () => {
      throw new Error("No files exist in empty cache");
    },
    readFileRaw: () => {
      throw new Error("No files exist in empty cache");
    },
    fileExists: async () => ({ exists: false }),
    createFileAndDirectories: () => {
      throw new Error("Cannot create anything in empty cache");
    },
    updateFile: () => {
      throw new Error("Cannot update anything in empty cache");
    },
    removeFile: () => {
      throw new Error("Cannot remove anything in empty cache");
    },
  };
};

export const buildCache = async ({
  searchDirectories,
}: {
  searchDirectories: string[];
}): Promise<FileCache> => {
  const listOfFilesAndDetails = await getContentsAndMetaOfAllFiles({
    // TODO: To recover from race conditions on initial build,
    // in the future, probably want to be able to start with the last cache.
    // Except that wouldn't account for deletions? Unless that was repaired first?
    fileCache: await buildEmptyCache(),
    searchDirectories,
  });

  const filesByContentPath: Record<string, FileContentsAndDetails> = {};
  listOfFilesAndDetails.forEach((everything) => {
    filesByContentPath[everything.contentPath] = everything;
  });
  const filesByTitle: Record<string, FileContentsAndDetails> = {};
  listOfFilesAndDetails.forEach((everything) => {
    if (typeof everything.meta.title !== "string") return;
    filesByTitle[everything.meta.title] = everything;
  });
  const fileCache: FileCache = {
    listOfFilesAndDetails,
    getByContentPath: (path) => filesByContentPath[path],
    getByTitle: (title) => filesByTitle[title],
    readFile: (path) =>
      // TODO: Read the file from the cache
      readFile({
        searchDirectories,
        contentPath: path,
      }),
    readFileRaw: (path) =>
      // TODO: Read from the cache
      readFileRaw({
        searchDirectories,
        contentPath: path,
      }),
    fileExists: async (path) =>
      filesByContentPath[path]
        ? { exists: true, ...filesByContentPath[path].originalContent }
        : { exists: false },
    createFileAndDirectories: async ({ directory, contentPath, content }) => {
      const result = await createFileAndDirectories({
        directory,
        contentPath,
        content,
      });

      const details: FileContentsAndDetails = await resolveDirEntToAllStuff({
        dirent: {
          name: basename(contentPath),
          contentPath,
          type: "file",
        },
        fileCache,
        searchDirectories,
      });

      // TODO: Hm this isn't technically wrong with the constraints of
      // shadowing.  That is, this file could be called to create a directory
      // deeper in the  stack of shadows, and maybe there's still a file higher
      // up that should shadow it. So maybe we shouldn't always be adding it
      // to these structures
      listOfFilesAndDetails.push(details);
      filesByContentPath[contentPath] = details;
      if (details.meta.title) {
        if (typeof details.meta.title !== "string") {
          log(`Title must be a string, got %o`, details.meta.title);
          throw new Error(`Title must be a string, see log`);
        }
        filesByTitle[details.meta.title] = details;
      }

      return result;
    },

    // TODO: Update cache. The "original contents" need to change at least
    updateFile: async ({ directory, contentPath, content }) =>
      updateFile({ directory, contentPath, content }),

    removeFile: async ({ directory, contentPath }) => {
      // TODO: Update the cache. This might mean searching for an uncovered
      // previously-shadowed core file. Maybe search the searchDirectories again
      // and start from there..
      return removeFile({ directory, contentPath });
    },
  };

  return fileCache;
};

const getFileContentsAndMetadata = async ({
  contentPath,
  searchDirectories,
  fileCache,
}: {
  fileCache: FileCache;
  contentPath: string;
  searchDirectories: string[];
}) => {
  const readResults = await readFile({
    searchDirectories,
    contentPath,
  });
  if (/\.html$/.test(contentPath)) {
    try {
      const result = await applyTemplating({
        fileCache,
        content: readResults.content,
        parameters: {},
        topLevelParameters: {},
        stopAtSelector: "body",
      });
      return {
        ...result,
        originalContent: readResults,
      };
    } catch (error) {
      throw new Error(
        `Couldn't apply templating for '${contentPath}': ${error}`,
      );
    }
  } else if (/\.md$/.test(contentPath)) {
    // TODO: Parse and separate frontmatter of markdown file
    return { originalContent: readResults };
  } else {
    return { originalContent: readResults };
  }
};

const getContentsAndMetaOfAllFiles = async ({
  searchDirectories,
  fileCache,
}: {
  searchDirectories: string[];
  fileCache: FileCache;
}): Promise<Array<FileContentsAndDetails>> => {
  const allDirents = await listAndMergeAllDirectoryContents({
    searchDirectories,
  });
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
  );
};

export const resolveDirEntToAllStuff = async ({
  dirent,
  fileCache,
  searchDirectories,
}: {
  dirent: MyDirectoryEntry;
  fileCache: FileCache;
  searchDirectories: string[];
}) => {
  const templateResults = await getFileContentsAndMetadata({
    fileCache,
    contentPath: dirent.contentPath,
    searchDirectories,
  });
  return {
    ...dirent,
    type: "file", // TypeScript doesnt track the filter above
    meta: "meta" in templateResults ? templateResults.meta : {},
    originalContent: templateResults.originalContent,
  } as const;
};

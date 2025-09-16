import { QueryError } from "./error.mts";
import { dirname, normalize } from "node:path";
import {
    mkdir,
    open,
    rm,
    writeFile,
    readFile as fsReadFile,
    readdir,
} from "node:fs/promises";

export const filePath = ({
    contentPath,
    directory,
}: {
    contentPath: string;
    directory: string;
}) =>
    // TODO: Find a good library to establish this is a real valid path
    `${directory}${contentPath}`;

export const createFileAndDirectories = async ({
    contentPath,
    directory,
    content,
}: {
    contentPath: string;
    directory: string;
    content: string;
}) => {
    try {
        await mkdir(
            filePath({ contentPath: dirname(contentPath), directory }),
            {
                recursive: true,
            },
        );
        const fd = await open(filePath({ contentPath, directory }), "wx");
        content = cleanContent({ content });
        await writeFile(fd, content);
        return content;
    } catch (error) {
        if (
            error instanceof Error &&
            "code" in error &&
            error.code === "EEXIST"
        ) {
            throw new QueryError(422, `File ${contentPath} already exists`);
        }
        throw error;
    }
};

export const readFile = async (params: {
    contentPath: string;
    searchDirectories: string[];
}): Promise<{ content: string; foundInDirectory: string }> => {
    const rawResults = await readFileRaw(params);
    return {
        content: rawResults.buffer.toString(),
        foundInDirectory: rawResults.foundInDirectory,
    };
};

export const readFileRaw = async ({
    contentPath,
    searchDirectories,
}: {
    contentPath: string;
    searchDirectories: string[];
}): Promise<{ buffer: Buffer; foundInDirectory: string }> => {
    for (const directory of searchDirectories) {
        const path = filePath({ contentPath, directory });
        try {
            const buffer = await fsReadFile(path);
            return { buffer, foundInDirectory: directory };
        } catch (error) {
            if (error instanceof Error) {
                if ("code" in error && error.code === "ENOENT") {
                    continue;
                }
            }

            throw error;
        }
    }
    throw new QueryError(
        404,
        `Couldn't find a file named ${contentPath}`,
        null,
    );
};

export const fileExists = async (params: {
    contentPath: string;
    searchDirectories: string[];
}): Promise<{ exists: true; foundInDirectory: string } | { exists: false }> => {
    try {
        const { foundInDirectory } = await readFileRaw(params);
        return { exists: true, foundInDirectory };
    } catch (error) {
        return { exists: false };
    }
};

export const updateFile = async ({
    contentPath,
    directory,
    content,
}: {
    contentPath: string;
    directory: string;
    content: string;
}) => {
    try {
        await open(filePath({ contentPath, directory }), "wx");
        throw new QueryError(
            404,
            `File ${contentPath} doesn't exist. Did you mean to create it?`,
        );
    } catch (error) {
        if (
            error instanceof Error &&
            "code" in error &&
            error.code === "EEXIST"
        ) {
            content = cleanContent({ content });
            await writeFile(filePath({ contentPath, directory }), content);
            return content;
        }
        throw error;
    }
};
export const removeFile = async ({
    contentPath,
    directory,
}: {
    contentPath: string;
    directory: string;
}) => {
    try {
        await open(filePath({ contentPath, directory }), "wx");
        throw new QueryError(404, `File ${contentPath} doesn't exist`);
    } catch (error) {
        if (
            error instanceof Error &&
            "code" in error &&
            error.code === "EEXIST"
        ) {
            rm(filePath({ contentPath, directory }));
            return;
        }
        throw error;
    }
};

/**
 * Return a list of all the unique paths which are accessible in the given
 * searchDirectories. Unique means that if the same path can access a file/dir
 * in more than one of the directories, only one entry for the that path is
 * included which reflects the entry in the earliest searchDirectory.
 **/
export const listAndMergeAllDirectoryContents = async ({
    searchDirectories,
}: {
    searchDirectories: string[];
}): ReturnType<typeof listAllDirectoryContents> => {
    const seenContentPaths = new Set<string>();
    const results = [];
    const resultsForEachDirectory = await Promise.all(
        searchDirectories.map((directory) =>
            listAllDirectoryContents({ directory }),
        ),
    );
    for (const resultsForDirectory of resultsForEachDirectory) {
        for (const result of resultsForDirectory) {
            if (seenContentPaths.has(result.contentPath)) continue;
            seenContentPaths.add(result.contentPath);
            results.push(result);
        }
    }
    return results;
};

export const listAllDirectoryContents = async ({
    directory,
}: {
    directory: string;
}): Promise<
    Array<{
        name: string;
        contentPath: string;
        type: "directory" | "file" | "other";
    }>
> => {
    const normalizedBaseDirectory = normalize(directory);
    const all = await readdir(normalizedBaseDirectory, {
        recursive: true,
        withFileTypes: true,
    });
    return all.map((dirent) => ({
        name: dirent.name,
        contentPath: `${dirent.parentPath.slice(
            normalizedBaseDirectory.length,
        )}/${dirent.name}`,
        type: dirent.isDirectory()
            ? "directory"
            : dirent.isFile()
              ? "file"
              : "other",
    }));
};

export const cleanContent = ({ content }: { content: string }) =>
    content
        // Browser sends CRLF, replace with unix-style LF,
        .replaceAll(/\r\n/g, "\n")
        // Remove any extra trailing spaces (but not double newlines!)
        .replaceAll(/[ \t\r]+\n/g, "\n");

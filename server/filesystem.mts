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
import debug from "debug";
const log = debug("server:filesystem");

export const filePath = ({
    contentPath,
    baseDirectory,
}: {
    contentPath: string;
    baseDirectory: string;
}) =>
    // TODO: Find a good library to establish this is a real valid path
    `${baseDirectory}${contentPath}`;

export const createFileAndDirectories = async ({
    contentPath,
    baseDirectory,
    content,
}: {
    contentPath: string;
    baseDirectory: string;
    content: string;
}) => {
    try {
        await mkdir(
            filePath({ contentPath: dirname(contentPath), baseDirectory }),
            {
                recursive: true,
            },
        );
        const fd = await open(filePath({ contentPath, baseDirectory }), "wx");
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

export const readFile = async ({
    contentPath,
    baseDirectory,
}: {
    contentPath: string;
    baseDirectory: string;
}): Promise<string> => {
    const path = filePath({ contentPath, baseDirectory });
    try {
        const buffer = await fsReadFile(path);
        return buffer.toString();
    } catch (error) {
        if (error instanceof Error) {
            if ("code" in error && error.code === "ENOENT") {
                throw new QueryError(
                    404,
                    `Couldn't find a file named ${contentPath}`,
                    error,
                );
            }
        }

        throw error;
    }
};

export const updateFile = async ({
    contentPath,
    baseDirectory,
    content,
}: {
    contentPath: string;
    baseDirectory: string;
    content: string;
}) => {
    try {
        await open(filePath({ contentPath, baseDirectory }), "wx");
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
            let fileToEditContents: string = await readFile({
                contentPath,
                baseDirectory,
            });

            log(`Logging contents of ${contentPath} before write:`);
            log(fileToEditContents);

            content = cleanContent({ content });
            await writeFile(filePath({ contentPath, baseDirectory }), content);
            return content;
        }
        throw error;
    }
};
export const removeFile = async ({
    contentPath,
    baseDirectory,
}: {
    contentPath: string;
    baseDirectory: string;
}) => {
    try {
        await open(filePath({ contentPath, baseDirectory }), "wx");
        throw new QueryError(404, `File ${contentPath} doesn't exist`);
    } catch (error) {
        if (
            error instanceof Error &&
            "code" in error &&
            error.code === "EEXIST"
        ) {
            rm(filePath({ contentPath, baseDirectory }));
            return;
        }
        throw error;
    }
};

export const listAllDirectoryContents = async ({
    baseDirectory,
}: {
    baseDirectory: string;
}) => {
    const normalizedBaseDirectory = normalize(baseDirectory);
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

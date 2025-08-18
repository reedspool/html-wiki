import test from "node:test";
import assert from "node:assert";
import {
    execute,
    listNonDirectoryFiles,
    type ParameterValue,
    setAllParameterWithSource,
} from "./engine.mts";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { QueryError } from "./error.mts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const baseDirectory = `${__dirname}/../entries`;
test("Render a file which doens't exist", { concurrency: true }, async () => {
    const parameters: ParameterValue = {};
    setAllParameterWithSource(
        parameters,
        {
            command: "read",
            contentPath: "/This file certainly doesn't exist",
            baseDirectory,
        },
        "query param",
    );
    const command = () => execute(parameters);

    await assert.rejects(command);

    try {
        await command();
        assert.fail();
    } catch (error) {
        if (error instanceof Error) {
            // The message
            assert.match(error.toString(), /Couldn't find/);
            // The name of the file
            assert.match(error.toString(), /\/.*file.*doesn't.*exist/);
            // Never show the baseDirectory path
            assert.doesNotMatch(error.toString(), /entries/);
        }

        if (error instanceof QueryError) {
            assert.equal(error.status, 404);
        } else {
            assert.fail("Expected a QueryError object");
        }
    }
});

test(
    "Generate list of files in baseDirectory",
    { concurrency: true },
    async () => {
        const allFiles = await listNonDirectoryFiles({ baseDirectory });
        [
            "/index.html",
            "/project/logbook.md",
            "/$/test/fixtures/test.md",
            "/$/templates/delete.html",
            "/$/templates/edit.html",
            "/$/templates/global-page.html",
            "/$/actions/create.html",
        ].forEach((contentPath) => assert.ok(allFiles.includes(contentPath)));
    },
);

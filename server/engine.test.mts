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
import { readFile } from "./filesystem.mts";
import { parse } from "node-html-parser";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const baseDirectory = `${__dirname}/../entries`;

async function executeAndParse(record: Record<string, string>) {
    const parameters: ParameterValue = {};
    setAllParameterWithSource(parameters, record, "query param");

    const { content, status } = await execute(parameters);
    const dom = parse(content);
    return {
        content,
        status,
        dom,
        $1: (selector: string) => dom.querySelector(selector)!,
        $: (selector: string) => dom.querySelectorAll(selector)!,
    };
}

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
    "Render an HTML template file as an HTML file",
    { concurrency: true },
    async () => {
        const { dom } = await executeAndParse({
            command: "read",
            contentPath: "/index.html",
            baseDirectory,
        });

        // They're the same minus whitespace changes caused from parsing
        // and re-stringifying
        assert.equal(
            dom.toString(),
            parse(
                await readFile({
                    baseDirectory,
                    contentPath: "/index.html",
                }),
            ).toString(),
        );
    },
);

test("Render sitemap", { concurrency: true }, async () => {
    const { $ } = await executeAndParse({
        command: "read",
        contentPath: "/sitemap.html",
        baseDirectory,
    });

    const listElements = $("li");
    assert.ok(
        listElements.length >= 7,
        `${listElements.length} was less than 7`,
    );
    listElements.forEach((li) => {
        assert.match(li.querySelector("a")?.attributes.href!, /^\//);
    });
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

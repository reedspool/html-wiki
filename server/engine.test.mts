import test from "node:test";
import assert from "node:assert";
import {
    execute,
    listNonDirectoryFiles,
    type ParameterValue,
    setEachParameterWithSource,
    setParameterChildrenWithSource,
} from "./engine.mts";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { QueryError } from "./error.mts";
import { readFile } from "./filesystem.mts";
import { parse } from "node-html-parser";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const baseDirectory = `${__dirname}/../entries`;

async function executeAndParse(parameters: ParameterValue) {
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
    setEachParameterWithSource(
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
        const { content } = await executeAndParse(
            setEachParameterWithSource(
                {},
                {
                    command: "read",
                    contentPath: "/index.html",
                    baseDirectory,
                },
                "query param",
            ),
        );

        // They're the same minus whitespace changes caused from parsing
        // and re-stringifying
        assert.equal(
            content,
            parse(
                await readFile({
                    baseDirectory,
                    contentPath: "/index.html",
                }),
            ).toString(),
        );
    },
);

test(
    "Render an HTML template file with rendered template content",
    { concurrency: true },
    async () => {
        const parameters: ParameterValue = {};
        setEachParameterWithSource(
            parameters,
            {
                command: "read",
                contentPath: "/$/templates/global-page.html",
                baseDirectory,
            },
            "query param",
        );

        const contentParameters: ParameterValue = {};
        setEachParameterWithSource(
            contentParameters,
            {
                select: "body",
                contentPath: "/index.html",
            },
            "derived",
        );
        setParameterChildrenWithSource(
            parameters,
            "contentParameters",
            contentParameters,
            "derived",
        );

        const { dom, $1 } = await executeAndParse(parameters);

        // All the global page stuff is there
        assert.match($1("header nav a:nth-child(1)").innerHTML, /HTML Wiki/);
        assert.match($1('header nav ul a[href="/"]').innerHTML, /Home/);
        assert.match($1('header nav a[href="/sitemap"]').innerHTML, /Sitemap/);

        assert.match($1("footer nav a:nth-child(1)").innerHTML, /HTML Wiki/);
        assert.match($1('footer nav ul a[href="/"]').innerHTML, /Home/);
        assert.match($1('footer nav a[href="/sitemap"]').innerHTML, /Sitemap/);

        // And the content is there
        assert.match($1("h1").innerHTML, /HTML Wiki/);
    },
);

test("Render sitemap", { concurrency: true }, async () => {
    const { $, $1 } = await executeAndParse(
        setEachParameterWithSource(
            {},
            {
                command: "read",
                contentPath: "/sitemap.html",
                baseDirectory,
            },
            "query param",
        ),
    );

    const listElements = $("li");
    assert.ok(
        listElements.length >= 7,
        `${listElements.length} was less than 7`,
    );
    assert.match($1("li a[href=/index.html]").innerHTML, /Homepage/);
    assert.match($1("li a[href=/sitemap.html]").innerHTML, /Sitemap/);
    // Falls back to filename
    assert.match($1("li a[href=/project/logbook.md]").innerHTML, /logbook\.md/);
});

test(
    "Generate list of files in baseDirectory",
    { concurrency: true },
    async () => {
        const allFiles = (await listNonDirectoryFiles({ baseDirectory })).map(
            ({ contentPath }) => contentPath,
        );
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

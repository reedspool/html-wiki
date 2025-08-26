import test from "node:test";
import assert from "node:assert";
import { pathToEntryFilename, queryEngine } from "./query.mts";
import {
    type ParameterValue,
    setEachParameterWithSource,
    setParameterChildrenWithSource,
    setParameterWithSource,
} from "./engine.mts";
import { Temporal } from "temporal-polyfill";
import { wait } from "./utilities.mts";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const baseDirectory = `${__dirname}/../entries`;

test("pathToEntryFilename", { concurrency: true }, (context) => {
    context.test(
        "All the different ways a URL could not have a leading slash error",
        { concurrency: true },
        () => {
            ["", "index", "index.html"].forEach((path) => {
                let didErr = false;
                try {
                    pathToEntryFilename(path);
                } catch (error) {
                    didErr = true;
                }
                if (!didErr) assert.fail();
            });
        },
    );

    context.test(
        "All the different ways to get index.html",
        { concurrency: true },
        () => {
            assert.equal(pathToEntryFilename("/"), "index.html");
            assert.equal(pathToEntryFilename("/index"), "index.html");
            assert.equal(pathToEntryFilename("/index.html"), "index.html");
        },
    );

    context.test("URIs are properly decoded", { concurrency: true }, () => {
        assert.equal(
            pathToEntryFilename(
                `/${encodeURIComponent(" Name with spaces")}/${encodeURIComponent("and")}/${encodeURIComponent("unencoded slashes")}`,
            ),
            " Name with spaces/and/unencoded slashes.html",
        );
    });
});

async function query({
    record,
    input,
}: {
    record: Record<string, string>;
    input: string;
}) {
    const parameters: ParameterValue = {};
    setEachParameterWithSource(parameters, record, "query param");
    const result = await queryEngine({
        parameters,
        topLevelParameters: parameters,
    })(input);
    return { result };
}

test("queryEngine", { concurrency: true }, (context) => {
    context.test(
        "Can get a string parameter by name",
        { concurrency: true },
        async () => {
            const { result } = await query({
                record: {
                    title: "test title",
                },
                input: "q/query/title",
            });
            assert.equal(result, "test title");
        },
    );
    context.test(
        "A missing parameter is falsy",
        { concurrency: true },
        async () => {
            const { result } = await query({
                record: {},
                input: "q/query/title",
            });
            assert.ok(!result);
        },
    );
    context.test("Can get current time", { concurrency: true }, async () => {
        const before = Temporal.Now.plainDateTimeISO();
        await wait(1);
        const { result } = await query({
            record: {},
            input: "q/Now.plainDateTimeISO()",
        });
        if (typeof result !== "string") {
            assert.fail("expected string result");
        }
        await wait(1);
        const resultParsed = Temporal.PlainDateTime.from(result);
        const after = Temporal.Now.plainDateTimeISO();
        assert.equal(Temporal.PlainDateTime.compare(resultParsed, before), 1);
        assert.equal(Temporal.PlainDateTime.compare(resultParsed, after), -1);
    });
    context.test(
        "Can get contentParameters.contentPath",
        { concurrency: true },
        async () => {
            const parameters: ParameterValue = {};
            parameters.contentParameters = {
                children: {
                    contentPath: {
                        value: "test content path",
                        source: "query param",
                    },
                },
                source: "query param",
            };
            const result = await queryEngine({
                parameters,
                topLevelParameters: parameters,
            })("q/query/contentParameters/contentPath");
            if (typeof result !== "string") {
                assert.fail("expected string result");
            }
            assert.equal(result, "test content path");
        },
    );
    context.test("Can render content", { concurrency: true }, async () => {
        const parameters: ParameterValue = {};
        setParameterChildrenWithSource(
            parameters,
            "contentParameters",
            {
                contentPath: {
                    value: "/index.html",
                    source: "query param",
                },
            },
            "query param",
        );
        setParameterWithSource(
            parameters,
            "baseDirectory",
            baseDirectory,
            "query param",
        );
        setParameterWithSource(
            parameters,
            "contentPath",
            "/index.html",
            "query param",
        );
        const result = await queryEngine({
            parameters,
            topLevelParameters: parameters,
        })("q/render/content");
        if (typeof result !== "string") {
            assert.fail("expected string result");
        }
        assert.match(result, /<h1>HTML Wiki<\/h1>/);
    });

    context.test(
        "Can get title of current list item",
        { concurrency: true },
        async () => {
            assert.fail(
                "Not getting meta data (like <title> vs filename) out from list items yet",
            );
            const parameters: ParameterValue = {};
            parameters.currentListItem = {
                children: {
                    title: {
                        value: "test title of list item",
                        source: "query param",
                    },
                },
                source: "query param",
            };
            const result = await queryEngine({
                parameters,
                topLevelParameters: parameters,
            })("q/params/currentListItem/title");
            if (typeof result !== "string") {
                assert.fail("expected string result");
            }
            assert.equal(result, "test title of list item");
        },
    );
});

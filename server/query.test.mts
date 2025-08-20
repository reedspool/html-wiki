import test from "node:test";
import assert from "node:assert";
import { pathToEntryFilename, queryEngine } from "./query.mts";
import { type ParameterValue, setAllParameterWithSource } from "./engine.mts";

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
    setAllParameterWithSource(parameters, record, "query param");
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
});

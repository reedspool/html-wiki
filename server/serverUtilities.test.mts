import test from "node:test";
import assert from "node:assert";
import { pathToEntryFilename } from "./serverUtilities.mts";

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
            assert.equal(pathToEntryFilename("/"), "/index.html");
            assert.equal(pathToEntryFilename("/index"), "/index.html");
            assert.equal(pathToEntryFilename("/index.html"), "/index.html");
        },
    );

    context.test("URIs are properly decoded", { concurrency: true }, () => {
        assert.equal(
            pathToEntryFilename(
                `/${encodeURIComponent(" Name with spaces")}/${encodeURIComponent("and")}/${encodeURIComponent("unencoded slashes")}`,
            ),
            "/ Name with spaces/and/unencoded slashes.html",
        );
    });
});

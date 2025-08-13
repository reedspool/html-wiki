import test from "node:test";
import assert from "node:assert";
import { execute } from "./engine.mts";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const baseDirectory = `${__dirname}/../entries`;
test("Render a file which doens't exist", { concurrency: true }, async () => {
    const result = await execute([
        [
            "test",
            {
                command: "read",
                contentPath: "/This file certainly doesn't exist",
                baseDirectory,
                parameters: { host: "testHost", protocol: "testProtocol" },
            },
        ],
    ]);

    assert.equal(result.status, 404);
});

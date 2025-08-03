import test from "node:test";
import assert from "node:assert";
import { fork } from "node:child_process";
import { printHtmlValidationReport, validateHtml } from "./testUtilities.mts";

// Would like to wait a lot less to perform these steps, but not sure how
const delay = 1000; // ms
const wait = (millis: number) => new Promise((r) => setTimeout(r, millis));

let somePort = 3000;
let nextPort: () => string = () => `${++somePort}`;

const forkCli = (port = nextPort()) => {
    const process = fork("./cli.mts", ["--port", port], {
        env: {},
    });
    return { port, process };
};

test("Server integration", { concurrency: true }, async (context) => {
    test(
        "Parallel tests work as expected",
        { concurrency: true },
        async (context) => {
            context.test(
                "Can run server and shut it down",
                { concurrency: true },
                async () => {
                    const { process } = forkCli();
                    assert.ok(process.connected);
                    await wait(delay);
                    process.kill("SIGINT");
                    await wait(delay);
                    assert.strictEqual(process.exitCode, 0);
                },
            );

            context.test(
                "Can run second server and shut it down",
                { concurrency: true },
                async () => {
                    const { process } = forkCli();
                    assert.ok(process.connected);
                    await wait(delay);
                    process.kill("SIGINT");
                    await wait(delay);
                    assert.strictEqual(process.exitCode, 0);
                },
            );
        },
    );

    test("Server basic operation", { concurrency: true }, async (context) => {
        context.test("Can get homepage", { concurrency: true }, async (t) => {
            const { process, port } = forkCli();
            assert.ok(process.connected);
            await wait(delay);
            t.after(async () => {
                process.kill("SIGINT");
                await wait(delay);
                assert.strictEqual(process.exitCode, 0);
            });
            const response = await fetch(`http://localhost:${port}`);
            const responseText = await response.text();

            assert.strictEqual(response.status, 200);
            assert.match(responseText, /<h1>HTML Wiki<\/h1>/);

            const report = await validateHtml(responseText);
            printHtmlValidationReport(report, (message: string) =>
                assert.fail(message),
            );

            // /index.html ges the same result as /
            const responseSlashIndexDotHtml = await fetch(
                `http://localhost:${port}/index.html`,
            );
            const responseTextSlashIndexDotHtml =
                await responseSlashIndexDotHtml.text();

            assert.strictEqual(response.status, 200);
            assert.strictEqual(responseText, responseTextSlashIndexDotHtml);

            // /index.html ges the same result as /
            const responseSlashIndexNoExtension = await fetch(
                `http://localhost:${port}/index`,
            );
            const responseTextSlashIndexNoExtension =
                await responseSlashIndexNoExtension.text();

            assert.strictEqual(response.status, 200);
            assert.strictEqual(responseText, responseTextSlashIndexNoExtension);
        });

        context.test(
            "Can get entry at weird path $/templates/edit.html",
            { concurrency: true },
            async (t) => {
                const { process, port } = forkCli();
                assert.ok(process.connected);
                await wait(delay);
                t.after(async () => {
                    process.kill("SIGINT");
                    await wait(delay);
                    assert.strictEqual(process.exitCode, 0);
                });
                const response = await fetch(
                    `http://localhost:${port}/$/templates/edit.html`,
                );
                const responseText = await response.text();

                assert.strictEqual(response.status, 200);
                assert.match(responseText, /<h1>Edit.*<\/h1>/);

                // The slot is still present, untransformed
                assert.match(
                    responseText,
                    /<slot name="content">Something went wrong.*<\/slot>/,
                );

                const report = await validateHtml(responseText, {
                    // TODO: The <slot> element can't be within a
                    // <textarea>, because no HTML can. Could choose to
                    // solve this by escaping it, or maybe this shows
                    // why the greater concept is flawed? Passing that
                    // buck for now
                    "element-permitted-content": "off",
                });
                printHtmlValidationReport(report, (message: string) =>
                    assert.fail(message),
                );
                // /index.html ges the same result as /
                const responseWithoutDotHtml = await fetch(
                    `http://localhost:${port}/$/templates/edit`,
                );
                const responseTextWithoutDotHtml =
                    await responseWithoutDotHtml.text();

                assert.strictEqual(response.status, 200);
                assert.strictEqual(responseText, responseTextWithoutDotHtml);
            },
        );

        context.test(
            "Normal path for no entry 404s",
            { concurrency: true },
            async (t) => {
                const { process, port } = forkCli();
                assert.ok(process.connected);
                await wait(delay);
                t.after(async () => {
                    process.kill("SIGINT");
                    await wait(delay);
                    assert.strictEqual(process.exitCode, 0);
                });
                const response = await fetch(
                    `http://localhost:${port}/This is a fake entry name`,
                );
                const responseText = await response.text();

                assert.strictEqual(response.status, 404);
                assert.match(responseText, /fake entry name/);

                const report = await validateHtml(responseText);
                printHtmlValidationReport(report, (message: string) =>
                    assert.fail(message),
                );
            },
        );

        context.test(
            "Edit page for no entry 404s",
            { concurrency: true },
            async (t) => {
                const { process, port } = forkCli();
                assert.ok(process.connected);
                await wait(delay);
                t.after(async () => {
                    process.kill("SIGINT");
                    await wait(delay);
                    assert.strictEqual(process.exitCode, 0);
                });
                const response = await fetch(
                    `http://localhost:${port}/This is a fake entry name?edit`,
                );
                const responseText = await response.text();

                assert.strictEqual(response.status, 404);
                assert.match(
                    responseText,
                    /fake entry name/,
                    "response contains the name you gave",
                );

                const report = await validateHtml(responseText);
                printHtmlValidationReport(report, (message: string) =>
                    assert.fail(message),
                );
            },
        );

        context.test(
            "Can get edit page for index",
            { concurrency: true },
            async (t) => {
                const { process, port } = forkCli();
                assert.ok(process.connected);
                await wait(delay);
                t.after(async () => {
                    process.kill("SIGINT");
                    await wait(delay);
                    assert.strictEqual(process.exitCode, 0);
                });
                const response = await fetch(
                    `http://localhost:${port}/index?edit`,
                );
                const responseText = await response.text();

                assert.strictEqual(response.status, 200);
                assert.match(responseText, /<h1>Edit.*<\/h1>/);

                const report = await validateHtml(responseText);
                printHtmlValidationReport(report, (message: string) =>
                    assert.fail(message),
                );
            },
        );

        context.test(
            "Can get edit page for weird path $/templates/edit",
            { concurrency: true },
            async (t) => {
                const { process, port } = forkCli();
                assert.ok(process.connected);
                await wait(delay);
                t.after(async () => {
                    process.kill("SIGINT");
                    await wait(delay);
                    assert.strictEqual(process.exitCode, 0);
                });
                const response = await fetch(
                    `http://localhost:${port}/$/templates/edit?edit`,
                );
                const responseText = await response.text();

                assert.strictEqual(response.status, 200);
                assert.match(responseText, /<h1>Edit.*<\/h1>/);

                // Should also include itself but escaped
                assert.match(responseText, /&lt;h1&gt;Edit.*&lt;\/h1&gt;/);

                const report = await validateHtml(responseText, {
                    // TODO: The <slot> element can't be within a
                    // <textarea>, because no HTML can. Could choose to
                    // solve this by escaping it, or maybe this shows
                    // why the greater concept is flawed? Passing that
                    // buck for now
                    "element-permitted-content": "off",
                });
                printHtmlValidationReport(report, (message: string) =>
                    assert.fail(message),
                );
            },
        );

        context.test(
            "Can get markdown entry rendered as HTML",
            { concurrency: true },
            async (t) => {
                const { process, port } = forkCli();
                assert.ok(process.connected);
                await wait(delay);
                t.after(async () => {
                    process.kill("SIGINT");
                    await wait(delay);
                    assert.strictEqual(process.exitCode, 0);
                });
                const response = await fetch(
                    `http://localhost:${port}/project/logbook.html`,
                );
                const responseText = await response.text();

                assert.strictEqual(response.status, 200);

                // The markdown has been transformed!
                assert.match(responseText, /<h1>About.*<\/h1>/);
                assert.match(responseText, /<h2>Logbook.*<\/h2>/);
                assert.match(responseText, /<h3>Sun\s+Aug\s+3.*<\/h3>/);
                // One of the links has been transformed properly
                assert.match(
                    responseText,
                    /<a href="http:\/\/tiddlywiki.com\/".*>TiddlyWiki<\/a>/,
                );

                const report = await validateHtml(responseText);
                printHtmlValidationReport(report, (message: string) =>
                    assert.fail(message),
                );
            },
        );
    });
});

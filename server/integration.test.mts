import test from "node:test";
import assert from "node:assert";
import { fork } from "node:child_process";
import {
    printHtmlValidationReport,
    validateAssertAndReport,
    validateHtml,
} from "./testUtilities.mts";

let somePort = 3000;
let nextPort: () => string = () => `${++somePort}`;

const forkCli = (port = nextPort()) => {
    const process = fork("./cli.mts", ["--port", port], {
        env: {},
    });
    return { port, process };
};

const { process, port } = forkCli();
assert.ok(process.connected);
// Predicting that the server will take a moment to start up soon, when I do more
// preparation
// const delay = 0; // ms
// const wait = (millis: number) => new Promise((r) => setTimeout(r, millis));
// await wait(delay);

test("Can get homepage", { concurrency: true }, async () => {
    const url = `http://localhost:${port}`;
    const response = await fetch(url);
    const responseText = await response.text();

    assert.strictEqual(response.status, 200);
    assert.match(responseText, /<h1>HTML Wiki<\/h1>/);

    await validateAssertAndReport(responseText, url);

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
        url.replace(/\.html$/, ""),
    );
    const responseTextSlashIndexNoExtension =
        await responseSlashIndexNoExtension.text();

    assert.strictEqual(response.status, 200);
    assert.strictEqual(responseText, responseTextSlashIndexNoExtension);
});

test(
    "Can get entry at weird path $/templates/edit.html",
    { concurrency: true },
    async () => {
        const url = `http://localhost:${port}/$/templates/edit.html`;
        const response = await fetch(url);
        const responseText = await response.text();

        assert.strictEqual(response.status, 200);
        assert.match(responseText, /<h1>Edit.*<\/h1>/);

        // The slot is still present, untransformed
        assert.match(
            responseText,
            /<slot name="content">Something went wrong.*<\/slot>/,
        );

        await validateAssertAndReport(responseText, url, {
            // TODO: The <slot> element can't be within a
            // <textarea>, because no HTML can. Could choose to
            // solve this by escaping it, or maybe this shows
            // why the greater concept is flawed? Passing that
            // buck for now
            "element-permitted-content": "off",
        });

        // /index.html ges the same result as /
        const responseWithoutDotHtml = await fetch(url.replace(/\.html$/, ""));
        const responseTextWithoutDotHtml = await responseWithoutDotHtml.text();

        assert.strictEqual(response.status, 200);
        assert.strictEqual(responseText, responseTextWithoutDotHtml);
    },
);

test("Normal path for no entry 404s", { concurrency: true }, async () => {
    const url = `http://localhost:${port}/This is a fake entry name`;
    const response = await fetch(url);
    const responseText = await response.text();

    assert.strictEqual(response.status, 404);
    assert.match(responseText, /fake entry name/);

    await validateAssertAndReport(responseText, url);
});

test("Edit page for no entry 404s", { concurrency: true }, async () => {
    const url = `http://localhost:${port}/This is a fake entry name?edit`;
    const response = await fetch(url);
    const responseText = await response.text();

    assert.strictEqual(response.status, 404);
    assert.match(
        responseText,
        /fake entry name/,
        "response contains the name you gave",
    );

    await validateAssertAndReport(responseText, url);
});

test("Can get edit page for index", { concurrency: true }, async () => {
    const url = `http://localhost:${port}/index?edit`;
    const response = await fetch(url);
    const responseText = await response.text();

    assert.strictEqual(response.status, 200);
    assert.match(responseText, /<h1>Edit.*<\/h1>/);

    await validateAssertAndReport(responseText, url);
});

test(
    "Can get edit page for weird path $/templates/edit",
    { concurrency: true },
    async () => {
        const url = `http://localhost:${port}/$/templates/edit?edit`;
        const response = await fetch(url);
        const responseText = await response.text();

        assert.strictEqual(response.status, 200);
        assert.match(responseText, /<h1>Edit.*<\/h1>/);

        // Should also include itself but escaped
        assert.match(responseText, /&lt;h1&gt;Edit.*&lt;\/h1&gt;/);

        // Save button should have a formaction without any special mode
        assert.match(responseText, /<button\s+type="submit"\s+formaction="\?"/);

        await validateAssertAndReport(responseText, url, {
            // TODO: The <slot> element can't be within a
            // <textarea>, because no HTML can. Could choose to
            // solve this by escaping it, or maybe this shows
            // why the greater concept is flawed? Passing that
            // buck for now
            "element-permitted-content": "off",
        });
    },
);

test(
    "Can get markdown entry rendered as HTML",
    { concurrency: true },
    async () => {
        const url = `http://localhost:${port}/project/logbook.html`;
        const response = await fetch(url);
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

        await validateAssertAndReport(responseText, url);

        // /<>.html ges the same result as /<>
        const responseWithoutDotHtml = await fetch(
            `http://localhost:${port}/project/logbook`,
        );
        const responseTextWithoutDotHtml = await responseWithoutDotHtml.text();

        assert.strictEqual(response.status, 200);
        assert.strictEqual(responseText, responseTextWithoutDotHtml);
    },
);

test(
    "Can get markdown entry rendered as raw",
    { concurrency: true },
    async () => {
        const url = `http://localhost:${port}/project/logbook.html?raw`;
        const response = await fetch(url);
        const responseText = await response.text();

        assert.strictEqual(response.status, 200);

        // The markdown has not been transformed!
        assert.match(responseText, /# About/);
        assert.match(responseText, /## Logbook/);
        assert.match(responseText, /### Sun\s+Aug\s+3/);
        assert.doesNotMatch(responseText, /<h1>About.*<\/h1>/);
        assert.doesNotMatch(responseText, /<h2>Logbook.*<\/h2>/);
        assert.doesNotMatch(responseText, /<h3>Sun\s+Aug\s+3.*<\/h3>/);
        // One of the links has not been transformed
        assert.match(responseText, /[Tiddlywiki][tiddlywiki]/);
        assert.doesNotMatch(
            responseText,
            /<a href="http:\/\/tiddlywiki.com\/".*>TiddlyWiki<\/a>/,
        );

        const report = await validateHtml(responseText);

        // Validation expected to fail because this markdown file is full of
        // tags inside inline code, e.g. `<tag>`.
        assert.equal(report.valid, false);

        // /<>.html ges the same result as /<>
        const responseWithoutDotHtml = await fetch(url.replace(/\.html/, ""));
        const responseTextWithoutDotHtml = await responseWithoutDotHtml.text();

        assert.strictEqual(response.status, 200);
        assert.strictEqual(responseText, responseTextWithoutDotHtml);
    },
);

test("Can get edit page for markdown file", { concurrency: true }, async () => {
    const url = `http://localhost:${port}/project/logbook?edit`;
    const response = await fetch(url);
    const responseText = await response.text();

    assert.strictEqual(response.status, 200);
    assert.match(responseText, /<h1>Edit(.|\n)*<\/h1>/);
    // Markdown appears within the text area
    assert.match(responseText, /<textarea(.|\n)*# About(.|\n)*<\/textarea>/m);
    assert.match(
        responseText,
        /<textarea(.|\n)*## Logbook(.|\n)*<\/textarea>/m,
    );
    assert.match(
        responseText,
        /<textarea(.|\n)*### Sun\s+Aug\s+3(.|\n)*<\/textarea>/m,
    );
    // HTML doesn't appear within the text area
    assert.doesNotMatch(
        responseText,
        /<textarea(.|\n)*<!doctype(.|\n)*<\/textarea>/m,
    );
    assert.doesNotMatch(
        responseText,
        /<textarea(.|\n)*<html>(.|\n)*<\/textarea>/m,
    );

    // HTML within the markdown content should come escaped
    assert.match(responseText, /&lt;code&gt;&lt;pre&gt;/);

    // Save button should have a formaction without any special mode
    assert.match(responseText, /<button\s+type="submit"\s+formaction="\?"/);

    await validateAssertAndReport(responseText, url);
});

test(
    "Can get edit page in raw mode for markdown file",
    { concurrency: true },
    async () => {
        const url = `http://localhost:${port}/project/logbook?edit&raw`;
        const response = await fetch(url);
        const responseText = await response.text();

        assert.strictEqual(response.status, 200);
        assert.match(responseText, /<h1>Edit(.|\n)*<\/h1>/);
        // Markdown still appears within the text area
        assert.match(
            responseText,
            /<textarea(.|\n)*# About(.|\n)*<\/textarea>/m,
        );
        assert.match(
            responseText,
            /<textarea(.|\n)*## Logbook(.|\n)*<\/textarea>/m,
        );
        assert.match(
            responseText,
            /<textarea(.|\n)*### Sun\s+Aug\s+3(.|\n)*<\/textarea>/m,
        );
        // HTML does appear within the text area, but escaped
        assert.match(
            responseText,
            /<textarea(.|\n)*&lt;!doctype(.|\n)*<\/textarea>/m,
        );
        assert.match(
            responseText,
            /<textarea(.|\n)*&lt;html lang=&quot;(.|\n)*<\/textarea>/m,
        );

        // Save button should have a formaction to raw mode
        assert.match(
            responseText,
            /<button\s+type="submit"\s+formaction="\?raw"/,
        );

        // HTML within the markdown content should still come escaped
        assert.match(responseText, /&lt;code&gt;&lt;pre&gt;/);

        await validateAssertAndReport(responseText, url);
    },
);

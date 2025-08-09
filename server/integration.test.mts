import test from "node:test";
import assert from "node:assert";
// import { fork } from "node:child_process";
import { validateAssertAndReport, validateHtml } from "./testUtilities.mts";
import { parse as parseHtml } from "node-html-parser";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { Temporal } from "temporal-polyfill";
import { html } from "./utilities.mts";
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let port = 3001;
// TODO: All this forking stuff seems to work (with the delay), but it doesn't
// print out the failed test results?
// let nextPort: () => string = () => `${++port}`;

// const forkCli = (port = nextPort()) => {
//     const process = fork("./cli.mts", ["--port", port], {
//         env: {},
//     });
//     return { port, process };
// };

// const { process, port } = forkCli();
// assert.ok(process.connected);
// const delay = 500; // ms
// const wait = (millis: number) => new Promise((r) => setTimeout(r, millis));
// await wait(delay);

// It's not really a path cuz I want to write param string there too?
async function getPath(path: string, status: number = 200) {
    const url = `http://localhost:${port}/${path}`;
    const response = await fetch(url);
    const responseText = await response.text();
    const dom = parseHtml(responseText);

    assert.strictEqual(response.status, status);

    return {
        url,
        response,
        responseText,
        dom,
        $: (selector: string) => dom.querySelector(selector),
    };
}
async function postPath(
    path: string,
    body: Record<string, string> = {},
    status: number = 200,
) {
    const url = `http://localhost:${port}/${path}`;
    const response = await fetch(url, {
        method: "post",
        body: new URLSearchParams(body),
    });
    const responseText = await response.text();
    const dom = parseHtml(responseText);

    assert.strictEqual(response.status, status);

    return {
        url,
        response,
        responseText,
        dom,
        $: (selector: string) => dom.querySelector(selector),
    };
}

test("Can get homepage", { concurrency: true }, async () => {
    const { url, response, responseText } = await getPath("");

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
        const { url, response, responseText } = await getPath(
            `$/templates/edit.html`,
        );

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
    const { url, responseText } = await getPath(
        `This is a fake entry name`,
        404,
    );

    assert.match(responseText, /fake entry name/);

    await validateAssertAndReport(responseText, url);
});

test("Edit page for no entry 404s", { concurrency: true }, async () => {
    const { url, responseText } = await getPath(
        `This is a fake entry name?edit`,
        404,
    );

    assert.match(
        responseText,
        /fake entry name/,
        "response contains the name you gave",
    );

    await validateAssertAndReport(responseText, url);
});

test("Can get edit page for index", { concurrency: true }, async () => {
    const { url, response, responseText } = await getPath(`index?edit`);

    assert.strictEqual(response.status, 200);
    assert.match(responseText, /<h1>Edit.*<\/h1>/);

    await validateAssertAndReport(responseText, url);
});

test(
    "Can get edit page for weird path $/templates/edit",
    { concurrency: true },
    async () => {
        const { url, response, responseText } = await getPath(
            `$/templates/edit?edit`,
        );

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
        const { url, response, responseText } =
            await getPath(`project/logbook.html`);

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
        const { url, response, responseText } = await getPath(
            `project/logbook.html?raw`,
        );

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
    const { url, response, responseText } =
        await getPath(`project/logbook?edit`);

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
        const { url, response, responseText } = await getPath(
            `project/logbook?edit&raw`,
        );

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

test("Can get create page", { concurrency: true }, async () => {
    const { url, responseText, $ } = await getPath(`$/actions/create`);

    assert.match($("h1").innerHTML, /Create/);

    // Filename has a timestamp
    assert.match(
        $("input[name=filename]").getAttribute("value")!,
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/,
    );
    // Text area is blank
    assert.match($("textarea").innerHTML!, /^\s*$/);

    // Save button should have a basic formaction
    assert.equal(
        $("button[type=submit]").getAttribute("formaction"),
        "/?create",
    );

    await validateAssertAndReport(responseText, url);
});

test("Can get create page with parameters", { concurrency: true }, async () => {
    const { url, response, responseText, $ } = await getPath(
        `$/actions/create?filename=posts/My new page&rand=3`,
    );

    assert.strictEqual(response.status, 200);
    assert.match(responseText, /<h1>Create(.|\n)*<\/h1>/);

    // Filename has a timestamp
    assert.equal(
        $("input[name=filename]").getAttribute("value")!,
        "posts/My new page",
    );
    // Text area is blank
    assert.match($("textarea").innerHTML!, /^\s*$/);

    // Save button should have a basic formaction
    assert.equal(
        $("button[type=submit]").getAttribute("formaction"),
        "/?create",
    );

    await validateAssertAndReport(responseText, url);
});

const tmpFileName = (extension: string = ".html") =>
    `test/tmp/file${Temporal.Now.plainDateTimeISO()}${extension}`;

//TODO: Instead of doing all these things at once, could use node filesystem commands to set up and clean up. With separate tests, it would be easier to tell if one thing was failing or everything was failing, and I'd have setups for more indepth testing of certain cases.
test("Can create, edit, and delete a page", { concurrency: true }, async () => {
    const filename = tmpFileName();
    const content = html`<!doctype html>
        <html lang="en-US">
            <head>
                <title>Test page</title>
            </head>
            <body>
                <h1>My First Testing Temp Page</h1>
                <p>
                    This is a page automatically created as part of integration
                    tests. It was supposed to be deleted, but I guess that
                    didn't work if you're looking at it?
                </p>
            </body>
        </html>`;
    const createResponse = await postPath(`?create`, {
        filename,
        content,
    });

    await validateAssertAndReport(
        createResponse.responseText,
        createResponse.url,
    );

    // Create redirects to the page's contents
    // TODO: Redirect, or just respond as if it redirected? If redirect, how could we detect the literal redirect (30x) instead of only the content?
    // TODO: Add a replacing mechanism here and test that it worked
    assert.match(
        createResponse.$("h1").innerHTML,
        /My First Testing Temp Page/,
    );
    assert.match(createResponse.$("p").innerHTML, /automatically created/);

    const fileContents = await readFile(`${__dirname}/../entries/${filename}`);
    assert.equal(fileContents, createResponse.responseText);

    // Can't create the same thing again
    const createAgainResponse = await postPath(
        `?create`,
        {
            filename,
            content,
        },
        422,
    );

    assert.match(createAgainResponse.responseText, new RegExp(`${filename}`));
    assert.match(createAgainResponse.responseText, /exists/);

    const getResponse = await getPath(filename);

    assert.equal(getResponse.responseText, createResponse.responseText);

    // Now edit the page
    const editedTitle = "My Edited First Testing Temp Page";
    getResponse.$("h1").innerHTML = editedTitle;
    const editedContent = getResponse.dom.toString();

    const editResponse = await postPath(filename, {
        content: editedContent,
    });

    // TODO: Redirect, or just respond as if it redirected? If redirect, how could we detect the literal redirect (30x) instead of only the content?
    // TODO: Add a replacing mechanism here and test that it worked
    assert.match(
        editResponse.$("h1").innerHTML,
        /My Edited First Testing Temp Page/,
    );
    assert.match(editResponse.$("p").innerHTML, /automatically created/);

    const getAfterEditResponse = await getPath(filename);

    assert.equal(editResponse.responseText, getAfterEditResponse.responseText);

    const deleteResponse = await postPath(filename + "?delete", {}, 400);

    assert.match(deleteResponse.responseText, new RegExp(filename));
    assert.match(deleteResponse.responseText, /are you sure/i);
    assert.match(deleteResponse.responseText, /cannot be undone/i);
    assert.match(
        deleteResponse.$(`button[type="submit"]`).innerHTML,
        /confirm and delete/i,
    );
    assert.ok(
        deleteResponse.$(
            `form[action="/${filename}?delete&delete-confirm"][method="POST"]`,
        ),
    );
    assert.match(deleteResponse.$(`a[href=/${filename}]`).innerHTML, /cancel/);
    assert.match(deleteResponse.$(`a[href=/${filename}]`).innerHTML, /go back/);

    const deleteConfirmResponse = await postPath(
        `${filename}?delete&delete-confirm`,
    );

    assert.match(deleteConfirmResponse.responseText, new RegExp(filename));
    assert.match(deleteConfirmResponse.responseText, /successfully deleted/i);

    await getPath(filename, 404);
});

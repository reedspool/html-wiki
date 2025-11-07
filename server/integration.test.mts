import test from "node:test"
import assert from "node:assert"
// import { fork } from "node:child_process";
import { validateAssertAndReport, validateHtml } from "./testUtilities.mts"
import { parse as parseHtml } from "node-html-parser"
import { readFile } from "node:fs/promises"
import { Temporal } from "temporal-polyfill"
import { html } from "./utilities.mts"
import stylelint from "stylelint"
import { configuredFiles } from "./configuration.mts"

let port = 3001
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
  if (path[0] !== "/")
    throw new Error("Paths must all start with a leading slash")
  const url = `http://localhost:${port}${path}`
  const response = await fetch(url)
  const responseText = await response.text()
  const dom = parseHtml(responseText)

  assert.strictEqual(response.status, status)

  return {
    url,
    response,
    responseText,
    dom,
    $1: (selector: string) => dom.querySelector(selector)!,
    $: (selector: string) => dom.querySelectorAll(selector)!,
  }
}
async function postPath(
  path: string,
  body: Record<string, string> | FormData = {},
  status: number = 200,
) {
  if (path[0] !== "/")
    throw new Error("Paths must all start with a leading slash")
  const url = `http://localhost:${port}${path}`
  let response
  try {
    response = await fetch(url, {
      method: "post",
      body: body instanceof FormData ? body : new URLSearchParams(body),
    })
  } catch (error) {
    console.log(`Fetch failed for URL ${url}: ${error}`)
    throw error
  }
  const responseText = await response.text()
  const dom = parseHtml(responseText)

  assert.strictEqual(response.status, status)

  return {
    url,
    response,
    responseText,
    dom,
    $1: (selector: string) => dom.querySelector(selector)!,
    $: (selector: string) => dom.querySelectorAll(selector)!,
  }
}

test("Can get homepage", { concurrency: true }, async () => {
  const { url, response, responseText } = await getPath("/")

  assert.strictEqual(response.status, 200)
  assert.match(responseText, /<h1>HTML Wiki<\/h1>/)

  await validateAssertAndReport(responseText, url)

  // /index.html ges the same result as /
  const responseSlashIndexDotHtml = await fetch(
    `http://localhost:${port}/index.html`,
  )
  const responseTextSlashIndexDotHtml = await responseSlashIndexDotHtml.text()

  assert.strictEqual(response.status, 200)
  assert.strictEqual(responseText, responseTextSlashIndexDotHtml)

  // /index.html ges the same result as /
  const responseSlashIndexNoExtension = await fetch(url.replace(/\.html$/, ""))
  const responseTextSlashIndexNoExtension =
    await responseSlashIndexNoExtension.text()

  assert.strictEqual(response.status, 200)
  assert.strictEqual(responseText, responseTextSlashIndexNoExtension)
})

test("Can get /system/global.css", { concurrency: true }, async () => {
  const path = "/system/global.css"
  const url = `http://localhost:${port}${path}`
  const response = await fetch(url)
  const responseText = await response.text()

  assert.strictEqual(
    response.headers.get("content-type"),
    "text/css; charset=utf-8",
  )
  assert.strictEqual(response.status, 200)
  // Find something basic which should be there
  assert.match(responseText, /:root\s+\{/)

  const stylelintResults = await stylelint.lint({
    config: { extends: ["stylelint-config-standard"] },
    code: responseText,
  })
  if (stylelintResults.errored) {
    assert.fail(stylelintResults.report)
  }
})

test("Normal path for no entry 404s", { concurrency: true }, async () => {
  const { url, responseText } = await getPath(`/This is a fake entry name`, 404)

  assert.match(responseText, /fake entry name/)

  await validateAssertAndReport(responseText, url)
})

test("Edit page for no entry 404s", { concurrency: true }, async () => {
  const { url, responseText } = await getPath(
    `/This is a fake entry name?edit`,
    404,
  )

  assert.match(
    responseText,
    /fake entry name/,
    "response contains the name you gave",
  )

  await validateAssertAndReport(responseText, url)
})

test(
  "Can get markdown entry rendered as HTML",
  { concurrency: true },
  async () => {
    const { url, responseText, $1, $ } = await getPath(
      configuredFiles.testMarkdownFile,
    )

    // The markdown has been transformed!
    assert.match($1("h1").innerHTML, /Markdown Fixture File Title/)
    assert.match($1("h2").innerHTML, /Second heading/)
    assert.equal($1("input[type=checkbox]").getAttribute("disabled")!, "")

    const anchors = $("main a")

    assert.match(anchors[0].innerHTML, /Google/)
    assert.match(anchors[0].getAttribute("href")!, /google\.com/)
    assert.match(anchors[1].innerHTML, /reference link/)
    assert.match(anchors[1].getAttribute("href")!, /\/index/)
    assert.match(
      anchors[2].innerHTML,
      /\/shortcut reference link with no associated reference link definition/,
    )
    assert.match(
      anchors[2].getAttribute("href")!,
      /\/shortcut%20reference%20link%20with%20no%20associated%20reference%20link%20definition/,
    )
    // Note there is no anchor made for the malformed "url w space in it" example
    assert.equal(anchors.length, 3)

    assert.match($1("em").innerHTML, /emphasized/)
    assert.match($1("strong").innerHTML, /bold/)
    const inlineCode = $(":not(:has(pre)) code")
    assert.match(inlineCode[0].innerHTML, /inline code/)
    assert.match(inlineCode[1].innerHTML, /&lt;code&gt;&lt;pre&gt;/)
    assert.equal(inlineCode[2], undefined)
    // Don't know why `pre code` doesn't work, but meh, probably
    // idiosyncracy with the parser library
    assert.match($1("pre").innerHTML, /<code/)
    assert.match($1("pre").innerHTML, /\/\/ Comment/)
    assert.match($1("pre").innerHTML, /\(\) =&gt; console.log\(/)

    await validateAssertAndReport(responseText, url)

    // The page should be exactly the same if we get it via its title
    const { responseText: byTitleResponseText } = await getPath(
      `/Markdown Fixture File Title`,
    )
    assert.strictEqual(responseText, byTitleResponseText)
  },
)

test(
  "Can get markdown entry with space in name rendered as HTML",
  { concurrency: true },
  async () => {
    const { url, responseText, $1, $ } = await getPath(
      configuredFiles.testMarkdownFileWithSpaceInName,
    )

    // The markdown has been transformed!
    assert.match($1("h1").innerHTML, /Test file with a space in the name/)
    await validateAssertAndReport(responseText, url)

    // The page should be exactly the same if we get it via its title
    const { responseText: byTitleResponseText } = await getPath(
      `/Test file with a space in the name`,
    )
    assert.strictEqual(responseText, byTitleResponseText)
  },
)

test(
  "Can get markdown entry with front matter",
  { concurrency: true },
  async () => {
    const { url, responseText, $1, $ } = await getPath(
      configuredFiles.testMarkdownFileWithYamlFrontmatter,
    )

    // The markdown has been transformed!
    assert.match($1("h1").innerHTML, /Test markdown file with yaml frontmatter/)
    assert.match($1("details summary").innerHTML, /Frontmatter/)
    assert.match(
      $1("details dd[data-frontmatter=title]").innerHTML,
      /\(title from frontmatter\)/,
    )
    assert.match($1("details dd[data-frontmatter=keywords]").innerHTML, /Media/)
    assert.match(
      $1("details dd[data-frontmatter=keywords]").innerHTML,
      /Currently reading/,
    )
    await validateAssertAndReport(responseText, url)

    // The page should be exactly the same if we get it via its title
    const { responseText: byTitleResponseText } = await getPath(
      `/Test markdown with frontmatter (title from frontmatter)`,
    )
    assert.strictEqual(responseText, byTitleResponseText)
  },
)

test(
  "Can get markdown entry rendered as raw",
  { concurrency: true },
  async () => {
    const { responseText, $1 } = await getPath(
      `/?contentPathOrContentTitle=${configuredFiles.testMarkdownFile}&raw`,
    )

    // The markdown has not been transformed!
    assert.match(responseText, /# Markdown Fixture File Title/)
    assert.match(responseText, /## Second heading/)
    assert.equal($1("h1"), null)
    assert.equal($1("h2"), null)
    assert.equal($1("input[type=checkbox]"), null)

    // One of the links has not been transformed
    assert.match(responseText, /[Google][https:\/\/www.google.com]/)

    const report = await validateHtml(responseText)

    // Validation expected to fail because this markdown file is full of
    // tags inside inline code, e.g. `<tag>`.
    assert.equal(report.valid, false)

    // The page should be exactly the same if we get it via its title
    const { responseText: byTitleResponseText } = await getPath(
      `/?contentPathOrContentTitle=Markdown Fixture File Title&raw`,
    )
    assert.strictEqual(responseText, byTitleResponseText)
  },
)

test("Can get edit page for markdown file", { concurrency: true }, async () => {
  const { url, responseText, $1 } = await getPath(
    `${configuredFiles.testMarkdownFile}?edit`,
  )

  assert.match($1("h1").innerHTML, /Edit/)
  // Markdown appears within the text area
  assert.match($1("textarea").innerHTML, /# Markdown Fixture File Title/)
  assert.match($1("textarea").innerHTML, /## Second heading/)
  // HTML doesn't appear within the text area
  assert.doesNotMatch($1("textarea").innerHTML, /<!doctype/)
  assert.doesNotMatch($1("textarea").innerHTML, /<html>/)

  // HTML within the markdown content should come escaped
  assert.match(responseText, /&lt;code&gt;&lt;pre&gt;/)

  // Save button should have a formaction without any special mode
  assert.match(
    responseText,
    /<button\s+type="submit"\s+formaction="\/fixtures\/test.md"/,
  )

  await validateAssertAndReport(responseText, url)

  // The page should be exactly the same as if we call the expanded version
  const expandedUrl = `http://localhost:${port}${configuredFiles.defaultPageTemplate}?content=${encodeURIComponent(`${configuredFiles.defaultEditTemplateFile}?select=body&content=${encodeURIComponent(`${configuredFiles.testMarkdownFile}?raw&escape`)}`)}`
  const responseForExpandedUrl = await fetch(expandedUrl)
  const responseTextForExpandedUrl = await responseForExpandedUrl.text()

  assert.strictEqual(responseForExpandedUrl.status, 200)
  assert.strictEqual(responseText, responseTextForExpandedUrl)

  // The page should be exactly the same if we get it via its title
  const { responseText: byTitleResponseText } = await getPath(
    `/Markdown Fixture File Title?edit`,
  )
  assert.strictEqual(responseText, byTitleResponseText)
})

test("Can get create page", { concurrency: true }, async () => {
  const { url, responseText, $1 } = await getPath(
    configuredFiles.defaultCreateTemplateFile,
  )

  assert.match($1("h1").innerHTML, /Create/)

  // Default file name is blank
  assert.equal($1("input[name=contentPath]").getAttribute("value")!, "")
  // Text area is blank
  assert.match($1("textarea").innerHTML!, /^\s*$/)

  // Save button should have a basic formaction
  assert.equal(
    $1("form[method=POST] button[type=submit]").getAttribute("formaction"),
    "/?create",
  )

  await validateAssertAndReport(responseText, url)
})

test("Can get create page with parameters", { concurrency: true }, async () => {
  const { url, response, responseText, $1 } = await getPath(
    `${configuredFiles.defaultCreateTemplateFile}?filename=/posts/My new page&fileContent=my content`,
  )

  assert.strictEqual(response.status, 200)
  assert.match(responseText, /<h1>Create(.|\n)*<\/h1>/)

  // Filename has the parameter content
  assert.equal(
    $1("input[name=contentPath]").getAttribute("value")!,
    "/posts/My new page",
  )
  assert.match($1("textarea").innerHTML!, /^my content$/)

  // Save button should have a basic formaction
  assert.equal(
    $1("form[method=POST] button[type=submit]").getAttribute("formaction"),
    "/?create",
  )

  await validateAssertAndReport(responseText, url)
})

const tmpFileName = (extension: string = ".html") =>
  `/tmp/tmpfile${Temporal.Now.plainDateTimeISO().toString().replaceAll(":", "_")}${extension}`

//TODO: Instead of doing all these things at once, could use node filesystem commands to set up and clean up. With separate tests, it would be easier to tell if one thing was failing or everything was failing, and I'd have setups for more indepth testing of certain cases.
test(
  "Can create, edit, and delete a page",
  { concurrency: true },
  async (context) => {
    const filename = tmpFileName()
    const content = html`<!doctype html>
      <html lang="en-US">
        <head>
          <title>Test page</title>
        </head>
        <body>
          <h1>My First Testing Temp Page</h1>
          <p>
            This is a page automatically created as part of integration test
            <code>${context.name}</code>. It was supposed to be deleted, but I
            guess that didn't work if you're looking at it?
          </p>
        </body>
      </html>`
    const createResponse = await postPath(`/?create`, {
      contentPath: filename,
      content,
    })

    assert.match(createResponse.responseText, /success/i)

    await validateAssertAndReport(
      createResponse.responseText,
      createResponse.url,
    )

    // Create used to redirect to the page's contents but no more
    const afterCreateResponse = await getPath(filename)

    // TODO: Redirect, or just respond as if it redirected? If redirect, how could we detect the literal redirect (30x) instead of only the content?
    // TODO: Add a replacing mechanism here and test that it worked
    assert.match(
      afterCreateResponse.$1("h1").innerHTML,
      /My First Testing Temp Page/,
    )
    assert.match(afterCreateResponse.$1("p").innerHTML, /automatically created/)

    const fileContents = await readFile(
      `${configuredFiles.testDirectory}${filename}`,
    )
    assert.equal(fileContents.toString(), content)

    // Can't create the same thing again
    const createAgainResponse = await postPath(
      `/?create`,
      {
        contentPath: filename,
        content,
      },
      422,
    )

    assert.match(
      createAgainResponse.responseText,
      new RegExp(`${filename.replaceAll(/\$/g, "\\$")}`),
    )
    assert.match(createAgainResponse.responseText, /exists/)

    // Now edit the page
    const editedTitle = "My Edited First Testing Temp Page"
    afterCreateResponse.$1("h1").innerHTML = editedTitle
    const editedContent = afterCreateResponse.dom.toString()

    const editResponse = await postPath(filename, {
      content: editedContent,
    })

    // TODO: Redirect, or just respond as if it redirected? If redirect, how could we detect the literal redirect (30x) instead of only the content?
    // TODO: Add a replacing mechanism here and test that it worked
    assert.match(editResponse.responseText, /success/i)

    const getAfterEditResponse = await getPath(filename)

    assert.match(getAfterEditResponse.$1("h1").innerHTML, /edited/i)

    const deleteResponse = await postPath(filename + "?delete", {}, 400)

    assert.match(
      deleteResponse.responseText,
      new RegExp(filename.replaceAll(/\$/g, "\\$")),
    )
    assert.match(deleteResponse.responseText, /are you sure/i)
    assert.match(deleteResponse.responseText, /cannot be undone/i)
    assert.match(
      deleteResponse.$1(`button[type="submit"]`).innerHTML,
      /confirm and delete/i,
    )
    assert.ok(
      deleteResponse.$1(
        `form[action="${filename}?delete&delete-confirm"][method="POST"]`,
      ),
    )
    assert.match(deleteResponse.$1(`a[href=${filename}]`).innerHTML, /cancel/)
    assert.match(deleteResponse.$1(`a[href=${filename}]`).innerHTML, /go back/)

    const deleteConfirmResponse = await postPath(
      `${filename}?delete&delete-confirm`,
    )

    assert.match(
      deleteConfirmResponse.responseText,
      new RegExp(filename.replaceAll(/\$/g, "\\$")),
    )
    assert.match(deleteConfirmResponse.responseText, /deleted successfully/i)

    await getPath(filename, 404)
  },
)

test(
  "Can edit a core file to shadow it and delete it again to reveal the core",
  { concurrency: true },
  async (context) => {
    const filePathToEdit = configuredFiles.rootIndexHtml
    const beforeChangeResponse = await getPath(filePathToEdit)

    assert.match(beforeChangeResponse.$1("h1").innerHTML, /HTML Wiki/)

    // The user directory version doesn't exist
    assert.rejects(() =>
      readFile(`${configuredFiles.testDirectory}${filePathToEdit}`),
    )

    const getEditResponse = await getPath(`${filePathToEdit}?edit`)

    assert.match(getEditResponse.responseText, /core directory/)
    assert.match(getEditResponse.responseText, /shadow/)
    assert.match(getEditResponse.responseText, /create/)
    assert.match(getEditResponse.responseText, /copy/)
    assert.match(
      getEditResponse
        .$1("input[type=hidden][name=contentPath]")
        .getAttribute("value")!,
      new RegExp(filePathToEdit),
    )

    // This page has stuff from the global page template
    assert.match(
      getEditResponse.$1("header nav a:nth-child(1)").innerHTML,
      /HTML Wiki/,
    )
    assert.match(
      getEditResponse.$1('header nav ul a[href="/"]').innerHTML,
      /Home/,
    )
    assert.match(
      getEditResponse.$1('header nav a[href="/sitemap.html"]').innerHTML,
      /Sitemap/,
    )

    assert.match(
      getEditResponse.$1("footer nav a:nth-child(1)").innerHTML,
      /HTML Wiki/,
    )
    assert.match(
      getEditResponse.$1('footer nav ul a[href="/"]').innerHTML,
      /Home/,
    )
    assert.match(
      getEditResponse.$1('footer nav a[href="/sitemap.html"]').innerHTML,
      /Sitemap/,
    )

    // TODO: This is an example where this integration test should really
    // occur in a real browser environment e.g. Playwright, because
    // this is what the button on the page should do, but it's impractical
    // to get all the stuff
    const createShadowCopyResponse = await postPath(`/?create`, {
      contentPath: filePathToEdit,
      content: (
        await readFile(`${configuredFiles.coreDirectory}${filePathToEdit}`)
      ).toString(),
    })

    // File now exists in user directory
    assert.doesNotReject(() =>
      readFile(`${configuredFiles.testDirectory}${filePathToEdit}`),
    )

    // Now edit the page
    const editedTitle = "My Edited First Testing Temp Page"
    beforeChangeResponse.$1("h1").innerHTML = editedTitle
    const editedContent = beforeChangeResponse.dom.toString()

    const editResponse = await postPath(filePathToEdit, {
      content: editedContent,
    })

    // TODO: Redirect, or just respond as if it redirected? If redirect, how could we detect the literal redirect (30x) instead of only the content?
    // TODO: Add a replacing mechanism here and test that it worked
    assert.match(editResponse.responseText, /success/i)

    const getAfterEditResponse = await getPath(filePathToEdit)

    assert.match(getAfterEditResponse.$1("h1").innerHTML, /edited/i)

    const deleteResponse = await postPath(filePathToEdit + "?delete", {}, 400)

    assert.match(
      deleteResponse.responseText,
      new RegExp(filePathToEdit.replaceAll(/\$/g, "\\$")),
    )
    assert.match(deleteResponse.responseText, /are you sure/i)
    assert.match(deleteResponse.responseText, /cannot be undone/i)
    assert.match(
      deleteResponse.$1(`button[type="submit"]`).innerHTML,
      /confirm and delete/i,
    )
    assert.ok(
      deleteResponse.$1(
        `form[action="${filePathToEdit}?delete&delete-confirm"][method="POST"]`,
      ),
    )
    assert.match(
      deleteResponse.$1(`a[href=${filePathToEdit}]`).innerHTML,
      /cancel/,
    )
    assert.match(
      deleteResponse.$1(`a[href=${filePathToEdit}]`).innerHTML,
      /go back/,
    )

    const deleteConfirmResponse = await postPath(
      `${filePathToEdit}?delete&delete-confirm`,
    )

    assert.match(
      deleteConfirmResponse.responseText,
      new RegExp(filePathToEdit.replaceAll(/\$/g, "\\$")),
    )
    assert.match(deleteConfirmResponse.responseText, /deleted successfully/i)

    // The path still works, but gets the original
    const afterDeleteResponse = await getPath(filePathToEdit, 200)

    assert.equal(
      afterDeleteResponse.responseText,
      beforeChangeResponse.responseText,
    )

    assert.rejects(() =>
      readFile(`${configuredFiles.testDirectory}${filePathToEdit}`),
    )
    assert.doesNotReject(() =>
      readFile(`${configuredFiles.coreDirectory}${filePathToEdit}`),
    )
  },
)

test(
  "Can delete a page immediately with confirmation",
  { concurrency: true },
  async (context) => {
    const filename = tmpFileName()
    const content = html`<!doctype html>
      <html lang="en-US">
        <head>
          <title>Test page for deletion</title>
        </head>
        <body>
          <h1>My First Testing Temp Page</h1>
          <p>
            This is a page automatically created as part of integration test
            <code>${context.fullName}</code>. It was supposed to be deleted, but
            I guess that didn't work if you're looking at it?
          </p>
        </body>
      </html>`
    const createResponse = await postPath(`/?create`, {
      contentPath: filename,
      content,
    })

    assert.match(createResponse.responseText, /success/i)
    const deleteConfirmResponse = await postPath(
      `${filename}?delete&delete-confirm`,
    )

    assert.match(
      deleteConfirmResponse.responseText,
      new RegExp(filename.replaceAll(/\$/g, "\\$")),
    )
    assert.match(deleteConfirmResponse.responseText, /deleted successfully/i)

    await getPath(filename, 404)
  },
)

test(
  "Getting the index page has the features from the global template",
  { concurrency: true },
  async () => {
    const { url, responseText, $1 } = await getPath("/")

    assert.match($1("header nav a:nth-child(1)").innerHTML, /HTML Wiki/)
    assert.match($1('header nav ul a[href="/"]').innerHTML, /Home/)
    assert.match($1('header nav a[href="/sitemap.html"]').innerHTML, /Sitemap/)

    assert.match($1("footer nav a:nth-child(1)").innerHTML, /HTML Wiki/)
    assert.match($1('footer nav ul a[href="/"]').innerHTML, /Home/)
    assert.match($1('footer nav a[href="/sitemap.html"]').innerHTML, /Sitemap/)

    await validateAssertAndReport(responseText, url)
  },
)

test(
  "Getting the edit page for the index has the features from the global template",
  { concurrency: true },
  async () => {
    const { url, responseText, $1 } = await getPath(`/?edit`)

    assert.match($1("header nav a:nth-child(1)").innerHTML, /HTML Wiki/)
    assert.match($1('header nav ul a[href="/"]').innerHTML, /Home/)
    assert.match($1('header nav a[href="/sitemap.html"]').innerHTML, /Sitemap/)

    assert.match($1("footer nav a:nth-child(1)").innerHTML, /HTML Wiki/)
    assert.match($1('footer nav ul a[href="/"]').innerHTML, /Home/)
    assert.match($1('footer nav a[href="/sitemap.html"]').innerHTML, /Sitemap/)

    await validateAssertAndReport(responseText, url)
  },
)

test(
  "Submit multipart/form-data to the share content receiver",
  { concurrency: true },
  async () => {
    const formData = new FormData()
    formData.append("title", "test title")
    formData.append("url", "test url")
    formData.append("text", "test text")
    const { responseText } = await postPath(
      configuredFiles.sharedContentReceiver,
      formData,
    )
    assert.match(responseText, /test title/i)
    assert.match(responseText, /test url/i)
    assert.match(responseText, /test text/i)
  },
)
test(
  "Submit multipart/form-data to the share content receiver has contents of global page",
  { concurrency: true },
  async () => {
    const formData = new FormData()
    const url = configuredFiles.sharedContentReceiver
    const { responseText, $1 } = await postPath(url, formData)

    assert.match($1("header nav a:nth-child(1)").innerHTML, /HTML Wiki/)
    assert.match($1('header nav ul a[href="/"]').innerHTML, /Home/)
    assert.match($1('header nav a[href="/sitemap.html"]').innerHTML, /Sitemap/)

    assert.match($1("footer nav a:nth-child(1)").innerHTML, /HTML Wiki/)
    assert.match($1('footer nav ul a[href="/"]').innerHTML, /Home/)
    assert.match($1('footer nav a[href="/sitemap.html"]').innerHTML, /Sitemap/)

    await validateAssertAndReport(responseText, url)
  },
)

import test from "node:test"
import assert from "node:assert"
import {
  execute,
  type ParameterValue,
  setEachParameterWithSource,
  setParameterChildrenWithSource,
} from "./engine.mts"
import { MissingFileQueryError } from "./error.mts"
import { readFile } from "./filesystem.mts"
import { parse } from "node-html-parser"
import { configuredFiles } from "./configuration.mts"
import { buildCache } from "./fileCache.mts"

const fileCache = await buildCache({
  searchDirectories: [
    configuredFiles.testDirectory,
    configuredFiles.coreDirectory,
  ],
})

async function executeAndParse(parameters: ParameterValue) {
  const { content, status } = await execute({ parameters, fileCache })
  const dom = parse(content)
  return {
    content,
    status,
    dom,
    $1: (selector: string) => dom.querySelector(selector)!,
    $: (selector: string) => dom.querySelectorAll(selector)!,
  }
}

test("Render a file which doesn't exist", { concurrency: true }, async () => {
  const parameters: ParameterValue = {}
  setEachParameterWithSource(
    parameters,
    {
      command: "read",
      contentPath: "/This file certainly doesn't exist",
      userDirectory: configuredFiles.testDirectory,
      coreDirectory: configuredFiles.coreDirectory,
    },
    "query param",
  )
  const command = () => execute({ parameters, fileCache })

  try {
    await command()
    assert.fail("Should have rejected")
  } catch (error) {
    if (error instanceof Error) {
      // The message
      assert.match(error.toString(), /Couldn't find/)
      // The name of the file
      assert.match(error.toString(), /\/.*file.*doesn't.*exist/)
      // Never show the coreDirectory path
      assert.doesNotMatch(error.toString(), /entries/)
      assert.doesNotMatch(error.toString(), /core/)
    }

    if (error instanceof MissingFileQueryError) {
      assert.equal(error.status, 404)
      assert.equal(error.missingPath, "/This file certainly doesn't exist")
    } else {
      assert.fail("Expected a MissingFileQueryError object")
    }
  }
})

test(
  "Render an HTML template file as an HTML file",
  { concurrency: true },
  async () => {
    const { content } = await executeAndParse(
      setEachParameterWithSource(
        {},
        {
          command: "read",
          nocontainer: "true",
          contentPath: "/index.html",
          userDirectory: configuredFiles.testDirectory,
          coreDirectory: configuredFiles.coreDirectory,
        },
        "query param",
      ),
    )

    const { content: fromTitleContent } = await executeAndParse(
      setEachParameterWithSource(
        {},
        {
          command: "read",
          nocontainer: "true",
          contentPathOrContentTitle: "HTML Wiki Homepage",
          userDirectory: configuredFiles.testDirectory,
          coreDirectory: configuredFiles.coreDirectory,
        },
        "query param",
      ),
    )

    assert.equal(content, fromTitleContent)

    // They're the same minus whitespace changes caused from parsing
    // and re-stringifying
    assert.equal(
      content,
      parse(
        (
          await readFile({
            searchDirectories: [
              configuredFiles.testDirectory,
              configuredFiles.coreDirectory,
            ],
            contentPath: "/index.html",
          })
        ).content,
      ).toString(),
    )
  },
)

test(
  "Render an HTML template file with rendered template content and container",
  { concurrency: true },
  async () => {
    const parameters: ParameterValue = {}

    setEachParameterWithSource(
      parameters,
      {
        command: "read",
        select: "body",
        contentPath: "/index.html",
      },
      "derived",
    )

    const { $1 } = await executeAndParse(parameters)

    // All the global page stuff is there
    assert.match($1("header nav a:nth-child(1)").innerHTML, /HTML Wiki/)
    assert.match($1('header nav ul a[href="/"]').innerHTML, /Home/)
    assert.match($1('header nav a[href="/recent.html"]').innerHTML, /Recent/)

    assert.match($1("footer nav a:nth-child(1)").innerHTML, /HTML Wiki/)
    assert.match($1('footer nav ul a[href="/"]').innerHTML, /Home/)
    assert.match($1('footer nav a[href="/recent.html"]').innerHTML, /Recent/)

    // And the content is there
    assert.match($1("h1").innerHTML, /HTML Wiki/)
  },
)

test("Render sitemap", { concurrency: true }, async () => {
  const resultByContentPath = await executeAndParse(
    setEachParameterWithSource(
      {},
      {
        command: "read",
        contentPath: "/sitemap.html",
        userDirectory: configuredFiles.testDirectory,
        coreDirectory: configuredFiles.coreDirectory,
      },
      "query param",
    ),
  )

  const resultByTitle = await executeAndParse(
    setEachParameterWithSource(
      {},
      {
        command: "read",
        contentPathOrContentTitle: "Sitemap",
        userDirectory: configuredFiles.testDirectory,
        coreDirectory: configuredFiles.coreDirectory,
      },
      "query param",
    ),
  )

  ;[resultByContentPath, resultByTitle].forEach(({ $, $1 }) => {
    const listElements = $("li")
    assert.ok(
      listElements.length >= 7,
      `${listElements.length} was less than 7`,
    )
    assert.match(
      $1(`li a[href=${configuredFiles.rootIndexHtml}]`).innerHTML,
      /Homepage/,
    )
    assert.match(
      $1(`li a[href=${configuredFiles.sitemapTemplate}]`).innerHTML,
      /Sitemap/,
    )
    // Falls back to filename
    assert.match(
      $1(`li a[href=${configuredFiles.testMarkdownFile}]`).innerHTML,
      /Markdown Fixture File Title/,
    )
  })
})

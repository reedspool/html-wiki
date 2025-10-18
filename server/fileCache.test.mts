import test from "node:test"
import assert from "node:assert"
import { buildCache } from "./fileCache.mts"
import { configuredFiles as files } from "./configuration.mts"

test("Cache has lots of stuff in it", { concurrency: true }, async () => {
  const cache = await buildCache({
    searchDirectories: [files.testDirectory, files.coreDirectory],
  })
  ;[
    files.defaultPageTemplate,
    files.rootIndexHtml,
    files.testMarkdownFile,
    files.defaultDeleteTemplateFile,
    files.defaultEditTemplateFile,
    files.defaultCreateTemplateFile,
    files.defaultCssFile,
  ].forEach((expectedContentPath) =>
    assert.ok(
      cache.listOfFilesAndDetails.find(
        ({ contentPath, originalContent }) =>
          contentPath == expectedContentPath,
      ),
      `'${expectedContentPath}' missing`,
    ),
  )

  assert.match(
    cache.getByContentPath(files.rootIndexHtml)!.meta.title as string,
    /HTML Wiki/,
  )
  assert.equal(
    cache.getByContentPath(files.sitemapTemplate)!.meta.title,
    "Sitemap",
  )
  assert.equal(
    cache.getByTitle("HTML Wiki Homepage")!.contentPath,
    files.rootIndexHtml,
  )

  assert.equal(
    cache.getByTitle("Markdown Fixture File Title")!.contentPath,
    files.testMarkdownFile,
  )

  assert.equal(cache.getByTitle("Sitemap")!.contentPath, files.sitemapTemplate)

  // I've gotten confused by these cases before, so ruling out
  assert.equal(cache.getByTitle(""), undefined)
  assert.equal(cache.getByTitle("/"), undefined)
})

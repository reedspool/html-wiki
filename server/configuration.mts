import { fileURLToPath } from "node:url"
import { dirname } from "node:path"
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const coreDirectory = `${__dirname}/../entries/core`
const testDirectory = `${__dirname}/../entries/test`
const documentationDirectory = `${__dirname}/../entries/documentation`
export const configuredFiles = {
  testDirectory,
  documentationDirectory,
  coreDirectory,
  defaultPageTemplate: "/system/templates/global-page.html",
  rootIndexHtml: "/index.html",
  logbook: "/project/logbook.md",
  testMarkdownFile: "/fixtures/test.md",
  testMarkdownFileWithSpaceInName: "/fixtures/file with a space in the name.md",
  testMarkdownFileWithYamlFrontmatter: "/fixtures/markdown with frontmatter.md",
  defaultDeleteTemplateFile: "/system/templates/delete.html",
  defaultEditTemplateFile: "/system/templates/edit.html",
  defaultCreateTemplateFile: "/system/actions/create.html",
  defaultCreateShadowTemplateFile: "/system/actions/create-shadow.html",
  defaultCssFile: "/system/global.css",
  fileMissingPageTemplate: "/404.html",
  sitemapTemplate: "/sitemap.html",
  // NOTE: If you change this, must be updated in site.webmanifest
  // and that will require anyone who has installed the app to re-install
  sharedContentReceiver: "/system/shared-content-receiver.html",
}

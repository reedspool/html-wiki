import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const coreDirectory = `${__dirname}/../entries/core`;
const testDirectory = `${__dirname}/../entries/test`;
const documentationDirectory = `${__dirname}/../entries/documentation`;
export const configuredFiles = {
    testDirectory,
    documentationDirectory,
    coreDirectory,
    defaultPageTemplate: "/$/templates/global-page.html",
    rootIndexHtml: "/index.html",
    logbook: "/project/logbook.md",
    testMarkdownFile: "/fixtures/test.md",
    defaultDeleteTemplateFile: "/$/templates/delete.html",
    defaultEditTemplateFile: "/$/templates/edit.html",
    defaultCreateTemplateFile: "/$/actions/create.html",
    defaultCreateShadowTemplateFile: "/$/actions/create-shadow.html",
    defaultCssFile: "/$/global.css",
    fileMissingPageTemplate: "/404.html",
    sitemapTemplate: "/sitemap.html",
};

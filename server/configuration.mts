import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const coreDirectory = `${__dirname}/../entries`;
export const configuredFiles = {
    coreDirectory,
    defaultPageTemplate: "/$/templates/global-page.html",
    rootIndexHtml: "/index.html",
    logbook: "/project/logbook.md",
    testMarkdownFile: "/$/test/fixtures/test.md",
    defaultDeleteTemplateFile: "/$/templates/delete.html",
    defaultEditTemplateFile: "/$/templates/edit.html",
    defaultCreateTemplateFile: "/$/actions/create.html",
    defaultCssFile: "/$/global.css",
    fileMissingPageTemplate: "/404.html",
};

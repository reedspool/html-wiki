import { HtmlValidate, type RuleConfig, type Report } from "html-validate"
import assert from "node:assert"
import debug from "debug"
const log = debug("server:testutilities")
// TODO: Maybe try using node-html-parser's valid method (already
// installed for server) to get rid of one dependency
const htmlvalidate = new HtmlValidate({
  extends: ["html-validate:recommended"],
  rules: {
    // I use Prettier for formatting HTML in my text editor and
    // it explicitly chooses not to do these things :(
    // See https://github.com/prettier/prettier/issues/5641
    "doctype-style": "off",
    "void-style": "off",
    // TODO: Using `replaceWith` and `remove` from node-html-parser
    // leaves a huge amount of unattractive whitespace. Want to fix that
    "no-trailing-whitespace": "off",

    // TODO: Added only because micromark makes checkboxes with disabled=""
    "attribute-boolean-style": "off",
  },
})

export async function validateAssertAndReport(
  responseText: string,
  url: string,
  rules?: RuleConfig,
) {
  const report = await validateHtml(responseText, rules)
  if (report.errorCount == 0 && report.warningCount == 0) return
  log(`Validation report for URL ${url}`)
  printHtmlValidationReport(report)
  assert.equal(
    report.valid,
    true,
    `See HTML validation errors above for URL ${url}`,
  )
}

export const validateHtml = (
  text: string,
  rules?: RuleConfig,
): Promise<Report> => {
  if (rules) {
    return htmlvalidate.validateString(text, { rules })
  }
  return htmlvalidate.validateString(text)
}

export const printHtmlValidationReport = (report: Report) => {
  // Copied from https://html-validate.org/guide/api/getting-started.html#displaying-the-results
  const severity = ["", "Warning", "Error"]
  log(`${report.errorCount} error(s), ${report.warningCount} warning(s)\n`)
  log("─".repeat(60))
  for (const result of report.results) {
    const lines = (result.source ?? "").split("\n")
    for (const message of result.messages) {
      const marker = message.size === 1 ? "▲" : "━".repeat(message.size)
      log("\n")
      log(severity[message.severity], `(${message.ruleId}):`, message.message)
      log(message.ruleUrl)
      log("\n")
      log(lines[message.line - 1])
      log(`${" ".repeat(message.column - 1)}${marker}`)
      log("\n")
      log("─".repeat(60))
    }
  }
}

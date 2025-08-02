import { HtmlValidate, type Report } from "html-validate";
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
    },
});

export const validateHtml = (text: string): Promise<Report> => {
    return htmlvalidate.validateString(text);
};

export const printHtmlValidationReport = (
    report: Report,
    onFail: (message: string) => void,
) => {
    // Copied from https://html-validate.org/guide/api/getting-started.html#displaying-the-results
    const severity = ["", "Warning", "Error"];
    if (report.valid) {
        return;
    }
    console.log(
        `${report.errorCount} error(s), ${report.warningCount} warning(s)\n`,
    );
    console.log("─".repeat(60));
    for (const result of report.results) {
        const lines = (result.source ?? "").split("\n");
        for (const message of result.messages) {
            const marker = message.size === 1 ? "▲" : "━".repeat(message.size);
            console.log();
            console.log(
                severity[message.severity],
                `(${message.ruleId}):`,
                message.message,
            );
            console.log(message.ruleUrl);
            console.log();
            console.log(lines[message.line - 1]);
            console.log(`${" ".repeat(message.column - 1)}${marker}`);
            console.log();
            console.log("─".repeat(60));
        }
    }
    onFail("See HTML validation errors");
};

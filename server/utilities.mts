import { type Request } from "express";
import { Parser, HtmlRenderer } from "commonmark";

// Stolen from NakedJSX https://github.com/NakedJSX/core
export const escapeHtml = (text: string) => {
    const htmlEscapeMap: Record<string, string> = {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
    };

    return text.replace(/[&<>"']/g, (m) => htmlEscapeMap[m] ?? "");
};

//TODO: Should probably add query onto this? Or maybe a separate version with that
export const urlFromReq = (req: Request) =>
    `${req.protocol}://${req.get("host")}${req.originalUrl}`;

export const renderMarkdown = (content: string) => {
    let reader = new Parser();
    let writer = new HtmlRenderer();
    let parsed = reader.parse(content);
    return writer.render(parsed);
};

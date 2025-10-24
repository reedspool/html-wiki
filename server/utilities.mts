import { type Request } from "express"
import YAML from "yaml"
import { Parser, HtmlRenderer } from "commonmark"

// Stolen from NakedJSX https://github.com/NakedJSX/core
export const escapeHtml = (text: string) => {
  const htmlEscapeMap: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  }

  return text.replace(/[&<>"']/g, (m) => htmlEscapeMap[m] ?? "")
}

//TODO: Should probably add query onto this? Or maybe a separate version with that
export const urlFromReq = (req: Request) =>
  `${req.protocol}://${req.get("host")}${req.originalUrl}`

export const renderMarkdown = (content: string) => {
  let reader = new Parser()
  let writer = new HtmlRenderer({
    safe: false,
  })
  let parsed = reader.parse(content)
  return writer.render(parsed)
}

// For IDE formatting. See https://prettier.io/blog/2020/08/24/2.1.0.html
export const html: typeof String.raw = (templates, ...args) =>
  String.raw(templates, ...args)

export const wait = (millis: number) =>
  new Promise((resolve) => setTimeout(resolve, millis))

export const parseFrontmatter = (content: string) => {
  if (!/^---\n(.|\n)*\n---\n/.test(content)) {
    return {
      restOfContent: content,
    }
  }

  // Empty string first entry
  const [_, frontmatterText, ...rest] = content.split(/---\n/)
  // Any of these symbols after the first are normal horizontal dividers
  const restOfContent = rest.join("---\n")

  const parsed = YAML.parse(frontmatterText)
  return {
    frontmatter: parsed,
    restOfContent,
  }
}

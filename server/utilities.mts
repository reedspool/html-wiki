import { type Request } from "express"
import YAML from "yaml"
import { micromark } from "micromark"
import { gfmHtml, gfm } from "micromark-extension-gfm"
import type { ReadonlyDeep } from "type-fest"

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

export const renderMarkdown = (content: string) =>
  micromark(content, {
    allowDangerousHtml: true,
    extensions: [gfm()],
    htmlExtensions: [gfmHtml()],
  })

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

export const disallowedParameterNames = `break
case
catch
class
const
continue
debugger
default
delete
do
else
export
extends
false
finally
for
function
if
import
in
instanceof
new
null
return
super
switch
this
throw
true
try
typeof
var
void
while
with
let 
static
yield 
await
enum
implements
interface
package
private
protected
public
null
false
true
undefined
`
  .split("\n")
  .map((word) => word.trim())

/**
 * Deeply freezes an object by recursively freezing all of its properties.
 *
 * - https://gist.github.com/tkrotoff/e997cd6ff8d6cf6e51e6bb6146407fc3
 * - https://stackoverflow.com/a/69656011
 *
 * FIXME Should be part of Lodash and related: https://github.com/Maggi64/moderndash/issues/139
 *
 * Does not work with Set and Map: https://stackoverflow.com/q/31509175
 */
export function deepFreeze<
  T,
  // Can cause: "Type instantiation is excessively deep and possibly infinite."
  //extends Jsonifiable
>(obj: T): ReadonlyDeep<T> {
  // @ts-expect-error
  Object.values(obj).forEach(
    (value) => Object.isFrozen(value) || deepFreeze(value),
  )
  return Object.freeze(obj) as ReadonlyDeep<T>
}

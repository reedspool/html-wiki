import { Temporal } from "temporal-polyfill"
import Fuse from "fuse.js"
import { setParameterWithSource, type ParameterValue } from "./engine.mts"
import debug from "debug"
import {
  disallowedParameterNames,
  escapeHtml,
  html,
  parseFrontmatter,
  renderMarkdown,
} from "./utilities.mts"
import { applyTemplating } from "./dom.mts"
import { type FileCache } from "./fileCache.mts"
import { cleanFilePath } from "./filesystem.mts"
import { configuredFiles } from "./configuration.mts"
import * as acorn from "acorn"
import * as walk from "acorn-walk"
const log = debug("server:queryLanguage")

// `p` is for "pipeline". Accepts functions and calls them with the previous result
export const p: (...args: unknown[]) => Promise<unknown> = async (...args) => {
  let lastValue = undefined
  for (const a of args) {
    if (typeof a === "function") {
      lastValue = a(lastValue)
    } else {
      lastValue = a
    }
    lastValue = await lastValue
  }
  return lastValue
}

export const siteProxy = ({ fileCache }: { fileCache: FileCache }) =>
  new Proxy(
    {},
    {
      get(_target: unknown, prop: string) {
        switch (prop) {
          case "allFiles":
            return fileCache.getListOfFilesAndDetails()
          case "fileTree":
            return fileCache.getContentPathsByDirectoryStructure()
          case "search":
            return async (query: string) => {
              const list = await fileCache.getListOfFilesAndDetails()
              // TODO: Probably want to cache this when we have an
              // active cache for the content of all files
              const fuse = new Fuse(list, {
                isCaseSensitive: false,
                // includeScore: false,
                // ignoreDiacritics: false,
                // shouldSort: true,
                // includeMatches: false,
                findAllMatches: true,
                minMatchCharLength: 3,
                // location: 0,
                // threshold: 0.6,
                // distance: 100,
                useExtendedSearch: false,
                ignoreLocation: false,
                ignoreFieldNorm: true,
                // fieldNormWeight: 1,
                keys: ["contentPath", "originalContent.content", "meta.title"],
              })
              return fuse.search(query).map(({ item }) => item)
            }
        }
      },
    },
  )

export const renderer =
  ({
    parameters: originalParameters,
    fileCache,
  }: {
    parameters: ParameterValue
    fileCache: FileCache
  }) =>
  async (
    contentPath: string,
    parameters: ParameterValue = {},
  ): Promise<string> => {
    const contentFileReadResult =
      fileCache.ensureByContentPath(contentPath).originalContent
    log(
      `Applying in-query templating for ${contentPath} original query content query ${JSON.stringify(parameters)}`,
    )
    // TODO: I think "noApply" is more accurate than "raw", however can
    // probably come up with a better name. The point is "raw" implies too
    // much, or could mean several things, so I should pick some more narrow
    // concepts, even if they have to be mixed and matched
    if (parameters.raw !== undefined) {
      if (parameters.escape !== undefined) {
        return escapeHtml(contentFileReadResult.content)
      }
      return contentFileReadResult.content
    }
    if (parameters.renderMarkdown !== undefined) {
      if (typeof parameters.contentPath !== "string") throw new Error()
      return specialRenderMarkdown({
        content: contentFileReadResult.content,
        contentPath: parameters.contentPath,
        fileCache,
      })
    }

    setParameterWithSource(
      parameters,
      "originalParameters",
      originalParameters,
      "derived",
    )
    return (
      await applyTemplating({
        fileCache,
        content: contentFileReadResult.content,
        parameters,
      })
    ).content
  }

export const specialRenderMarkdown = async ({
  content,
  contentPath,
  fileCache,
}: {
  content: string
  contentPath: string
  fileCache: FileCache
}) => {
  {
    // Find all reference link definitions
    const labels = Array.from(content.matchAll(/\[([^\]]+)\]([^(:]|$)/g))
      .map(([_, label]) => label)
      .filter((label) => /\S/.test(label))

    content += "\n"
    content += "\n"
    content += labels
      .map((l) => `[${l}]: <${l}> "Auto-generated wikilink"`)
      .join("\n")
  }

  {
    // Backlinks
    const backlinks = await fileCache.getBacklinksByContentPath(contentPath)
    content += "\n"
    content += "\n"
    content += html`<details open>
      <summary>Backlinks</summary>
      <ul>
        ${backlinks.length
          ? backlinks
              .map(
                (link) =>
                  html`<li>
                    <a href="${link}"
                      >${fileCache.getByContentPath(link)?.meta?.title ??
                      link}</a
                    >
                  </li>`,
              )
              .join("\n")
          : "No backlinks"}
      </ul>
    </details>`
  }

  {
    // Keywords
    const fileStuff = fileCache.getByContentPath(contentPath)
    const originalKeywords = fileStuff?.meta?.keywords ?? []
    const keywords =
      typeof originalKeywords === "string"
        ? originalKeywords.split(",")
        : originalKeywords
    content += "\n"
    content += "\n"
    content += html`<details open>
      <summary>Keywords</summary>
      <ul>
        ${keywords.length
          ? keywords
              .map(
                (keyword) =>
                  html`<li>
                    <a
                      href="${configuredFiles.keywordPageTemplate}?keyword=${keyword}"
                      >${keyword}</a
                    >
                  </li>`,
              )
              .join("\n")
          : "No keywords"}
      </ul>
    </details>`
  }

  {
    // Frontmatter
    const parsed = parseFrontmatter(content)
    content = parsed.restOfContent
    if (parsed.frontmatter) {
      content += "\n"
      content += "\n"
      content += html`<details>
        <summary>Frontmatter</summary>
        ${Object.entries(parsed.frontmatter)
          .map(
            ([key, value]) =>
              html`<dl>
                <dt>${key}</dt>
                <dd data-frontmatter="${key}">${value}</dd>
              </dl>`,
          )
          .join("\n")}
      </details>`
    }
  }

  // TODO if this set contents instead of returning that would seem to enable template values in markdown
  return renderMarkdown(content)
}

export const or = (...args: unknown[]) => args.reduce((a, b) => a || b)
export const and = (...args: unknown[]) => args.reduce((a, b) => a && b)

export const buildMyServerPStringContext = ({
  parameters,
  fileCache,
}: {
  fileCache: FileCache
  parameters: ParameterValue
}): PStringContext => {
  const utilities = {
    fileCache,
    escapeHtml,
    cleanFilePath,
    Temporal,
    site: siteProxy({
      fileCache,
    }),
    render: renderer({
      fileCache,
      parameters,
    }),
    or,
    and,
    answer: (input: string) =>
      pString(
        input,
        buildMyServerPStringContext({
          parameters,
          fileCache,
        }),
      ),
  }

  return {
    ...utilities,
    ...parameters,

    // Non-overide-able reference to these things to avoid possible conflicts
    // and possibly undefined parameters
    parameters,
    utilities,
    delete: undefined,
  }
}

// From https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/AsyncFunction/AsyncFunction
// AsyncFunction isn't a global constructor but it works just like Function
// Except TypeScript doesn't seem to think `new AsyncFunction` works, but it
// does in Node console.
const AsyncFunction = async function () {}.constructor

export type PStringContext = Record<string, unknown>
export const pString: (
  pArgList: string,
  context: PStringContext,
) => ReturnType<typeof p> = async (pArgList, context) => {
  context = { ...context, p }
  // If this ecmaVersion becomes an issue, try https://github.com/acornjs/acorn/tree/master/acorn-loose/
  const parsed = acorn.parse(pArgList, {
    ecmaVersion: "latest",
    allowAwaitOutsideFunction: true,
  })
  walk.simple(parsed, {
    Identifier({ name }) {
      if (!(name in context) && !(name in globalThis)) context[name] = undefined
    },
  })
  // Fancyness for dynamic named parameters
  const args: string[] = []
  const values: unknown[] = []
  Object.entries(context).forEach(([key, value]) => {
    if (disallowedParameterNames.includes(key)) return
    args.push(key)
    values.push(value)
  })
  // Debug it?
  // args.push(`debugger;return p(${pArgList});`)
  // Finally, the function body
  args.push(`return p(${pArgList});`)
  const fn = AsyncFunction(...args)

  Object.defineProperty(fn, "name", {
    value: "pString anonymous function",
  })
  return fn(...values)
}

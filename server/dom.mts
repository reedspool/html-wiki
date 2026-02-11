import { type Node, NodeType, HTMLElement } from "node-html-parser"
import { parse as parseHtml } from "node-html-parser"
import {
  AnswerError,
  type AnswerErrorFileLocation,
  QueryError,
  UsageError,
} from "./error.mts"
import { buildMyServerPStringContext, pString } from "./queryLanguage.mts"
import { escapeHtml } from "./utilities.mts"
import {
  maybeStringParameterValue,
  type ParameterValue,
  setParameterWithSource,
  stringParameterValue,
} from "./engine.mts"
import debug from "debug"
import { type FileCache } from "./fileCache.mts"
const log = debug("server:dom")
export type Meta = Record<string, string | string[]>

export const applyTemplating = async (
  params: {
    fileCache: FileCache
    parameters: ParameterValue
    rootSelector?: string
  } & (
    | {
        content: string
      }
    | {
        element: HTMLElement
      }
  ),
): Promise<{
  content: string
  meta: Meta
  links: Array<string>
}> => {
  const { parameters, fileCache } = params
  const getQueryValue = async (query: string) => {
    try {
      return await pString(
        query,
        buildMyServerPStringContext({
          parameters,
          fileCache,
        }),
      )
    } catch (error) {
      const location: AnswerErrorFileLocation = { line: -1 }
      if (element?.range) {
        // TODO: I don't think this makes sense for passed-in element but...
        const stringifiedContent =
          "content" in params ? params.content : root.toString()
        const [startPos, _endPos] = element.range
        // The count of all new lines before startPos
        location.line =
          stringifiedContent.slice(0, startPos).matchAll(/\n/g).toArray()
            .length + 1
        // Column is the distance between startPos and the most recent newline
        const lastNewline = stringifiedContent
          .slice(0, startPos)
          .lastIndexOf("\n")
        location.column =
          lastNewline === -1 ? startPos : startPos - lastNewline - 1
      }
      throw new AnswerError(
        ((parameters.contentPath ?? parameters.contentPathOrContentTitle) as
          | string
          | undefined) ?? "anonymous",
        location,
        query,
        error,
      )
    }
  }
  const meta: Meta = {}
  const links: Array<string> = []
  let root: HTMLElement
  if ("content" in params) {
    root = parseHtml(params.content)
  } else if ("element" in params) {
    root = params.element
  } else {
    throw new Error("element or content is required")
  }

  let alreadySetForNextIteration: Node | null = null

  // TODO: If root selector is body, this prevents all processing in head which
  // disallows "declare" to be safely put there. Hum but this isn't an issue yet?
  if (maybeStringParameterValue(parameters, "rootSelector")) {
    const selectedRoot = root.querySelector(
      stringParameterValue(parameters, "rootSelector"),
    )
    if (!selectedRoot) return { content: "", meta, links }
    root = selectedRoot
  }

  const treeWalker = new TreeWalker(root, NodeFilter.SHOW_ELEMENT)

  let element: HTMLElement
  do {
    alreadySetForNextIteration = null
    if (treeWalker.currentNode.nodeType !== NodeType.ELEMENT_NODE) {
      throw new Error(
        `Treewalker showed a non-HTMLElement Node '${treeWalker.currentNode}'`,
      )
    }
    element = treeWalker.currentNode as HTMLElement

    const attributeEntries = Object.entries(element.attributes)
    for (let i = 0; i < attributeEntries.length; i++) {
      const [key, value] = attributeEntries[i]
      const match = key.match(/^x(-escape)?-(.*)$/)
      if (!match) {
        continue
      }
      const isEscape = match[1] === "-escape"
      const realKey = match[2]
      const queryValue = await getQueryValue(value)
      switch (realKey) {
        case "content":
          let valueToSet
          if (typeof queryValue !== "string") {
            if (typeof (queryValue as object)?.["toString"] === "function") {
              valueToSet = (queryValue as object).toString()
            } else {
              valueToSet = "&lt;no textual representation&gt;"
            }
          } else {
            valueToSet = queryValue
          }

          if (isEscape) {
            element.innerHTML = escapeHtml(valueToSet)
          } else {
            element.innerHTML = valueToSet
          }
          break
        default:
          element.setAttribute(
            realKey,
            typeof queryValue === "string" ? queryValue : String(queryValue),
          )
          break
      }
    }

    switch (element.tagName) {
      case "LINK":
        if (element.attributes.rel === "icon") {
          meta.favicon = element.attributes.href
        }
        break
      case "META":
        switch (element.attributes.name) {
          case "description":
            meta[element.attributes.name] = element.attributes.content
            break
          case undefined:
            break
          default:
            break
        }
        switch (element.attributes.itemprop) {
          case undefined:
            break
          case "tag":
          case "tags":
            if (!meta.tags) meta.tags = []
            ;(meta.tags as string[]).push(
              ...element.attributes.content.trim().split(/\s*,\s*/),
            )
            break
          case "nocontainer":
            meta.nocontainer = "nocontainer"
            break
          default:
            meta[element.attributes.itemprop] = element.attributes.content
            break
        }

        break
      case "TITLE":
        meta.title = element.innerText
        break
      case "A":
        if (element.attributes.href) {
          links.push(element.attributes.href)

          element.setAttribute(
            "href",
            (await getQueryValue(
              `'${element.attributes.href.replace("'", "\\'")}', goodHref`,
            )) as string,
          )
        }
        break
      case "MAP-LIST":
        {
          const query = element.getAttribute("q")
          if (!query) {
            throw new QueryError(
              500,
              `map-list must have 'q' with a query as value, got value ${query}`,
            )
          }

          let queryValue = await getQueryValue(query)
          if (!Array.isArray(queryValue)) {
            if (queryValue === undefined || queryValue === null) {
              queryValue = []
            } else if (element.hasAttribute("allow-one")) {
              queryValue = [queryValue]
            } else {
              throw new Error("Expected an array value for map-list")
            }
          }
          if (!Array.isArray(queryValue)) {
            throw new Error("Shouldn't have gotten here")
          }
          alreadySetForNextIteration = treeWalker.nextNodeNotChildren()
          const topLevelParameters = parameters
          const originalElementChildren = [...element.children]
          for (const index in queryValue.reverse()) {
            const current = queryValue[index]
            const parameters: ParameterValue = {
              ...topLevelParameters,
              rootSelector: undefined,
              select: undefined,
            }
            setParameterWithSource(
              parameters,
              "list",
              queryValue,
              "query param",
            )
            setParameterWithSource(parameters, "index", index, "query param")
            setParameterWithSource(
              parameters,
              "currentListItem",
              current,
              "query param",
            )
            // Even though we're going to place everything in
            // reverse order (with .after()), start in-order for
            // imperative templating logic like `set-`
            const toPlace = []
            for (const childElement of originalElementChildren) {
              const childElementClone = childElement.clone() as HTMLElement
              // This typing is just wrong. Null is perfectly valid
              childElementClone.parentNode = element.parentNode
              const { content } = await applyTemplating({
                fileCache,
                element: childElementClone,
                parameters,
              })
              toPlace.push(content)
            }

            element.after(...toPlace)
          }
          element.remove()
        }
        break
      case "QUERY-CONTENT":
        {
          const attributeEntries = Object.entries(element.attributes)
          if (attributeEntries[0][0] !== "q") {
            throw new QueryError(
              500,
              "query-content only supports a single attribute, `q` whose value is the query to use to replace ",
            )
          }
          if (typeof attributeEntries[0][1] !== "string") {
            throw new QueryError(
              500,
              `query-content first attribute must be 'q' with a query as value, got value ${attributeEntries[0][1]}`,
            )
          }
          const query = attributeEntries[0][1]

          let queryValue = await getQueryValue(query)
          if (!queryValue) {
            queryValue = element.innerHTML
          }
          if (typeof queryValue !== "string") {
            throw new Error("query value expected string")
          }
          alreadySetForNextIteration = treeWalker.nextNodeNotChildren()
          element.after(queryValue)
          element.remove()
        }
        break

      case "DEBUGGER-":
        debugger
        break
      case "SET-":
        {
          for (const [parameterName, query] of Object.entries(
            element.attributes,
          )) {
            let queryValue = await getQueryValue(query)
            // TODO: This sets the parameter for everything after this,
            // but it would be cool if parameters were a scope concept
            // and this could createa new scope only for the processing
            // of the contents of this tag
            setParameterWithSource(
              parameters,
              parameterName,
              queryValue,
              "query param",
            )
          }
        }
        break
      case "LOAD-":
        {
          for (const [parameterName, contentPath] of Object.entries(
            element.attributes,
          )) {
            let queryValue = await getQueryValue(
              `fileCache.getByContentPathOrContentTitle('${contentPath}'),p=>p.actualPath`,
            )
            // TODO: This sets the parameter for everything after this,
            // but it would be cool if parameters were a scope concept
            // and this could createa new scope only for the processing
            // of the contents of this tag
            if (typeof queryValue !== "string") {
              throw new Error(
                "<load-> attribute values must resolve to strings",
              )
            }
            const result = await import(queryValue)
            setParameterWithSource(
              parameters,
              parameterName,
              result,
              "query param",
            )
          }
        }
        break
      case "DROP-IF":
      case "KEEP-IF":
        {
          let shouldDrop = element.tagName === "DROP-IF"
          const attributeEntries = Object.entries(element.attributes)
          if (attributeEntries.length > 1) {
            throw new Error("drop-/keep-if require exactly one attribute")
          }
          const conditionalKey = attributeEntries[0][0]
          const value = attributeEntries[0][1]

          let conditional = false
          switch (conditionalKey) {
            case "falsy": {
              conditional = !(await getQueryValue(value))
            }
            case "truthy":
              {
                conditional = !!(await getQueryValue(value))
              }
              break
            default:
              throw new UsageError(
                `drop-if can only have 'truthy' or 'falsy' attributes but found '${conditionalKey}'`,
              )
          }

          if (!conditional) shouldDrop = !shouldDrop
          if (shouldDrop) {
            alreadySetForNextIteration = treeWalker.nextNodeNotChildren()
          } else {
            alreadySetForNextIteration = treeWalker.nextNode()
            for (const childNode of element.childNodes.reverse()) {
              element.after(childNode)
            }
          }
          element.remove()
        }
        break
      case "RENDER-":
      case "R-": {
        const attributeEntries = Object.entries(element.attributes)

        let shouldKeepContents = true
        if (element.hasAttribute("map") && element.hasAttribute("content")) {
          throw new Error("Can only use one of map or content in render-")
        }

        attributes: for (const [key, value] of attributeEntries) {
          switch (key) {
            // TODO: SET? E.g. set:foo='bar' ? or set="foo=bar"?
            case "map":
              {
                let queryValue = await getQueryValue(value)
                if (!Array.isArray(queryValue)) {
                  if (queryValue === undefined || queryValue === null) {
                    queryValue = []
                  } else if (element.hasAttribute("allow-one")) {
                    queryValue = [queryValue]
                  } else {
                    throw new Error("Expected an array value for map-list")
                  }
                }

                if (!Array.isArray(queryValue)) {
                  throw new Error("Map value was not an array somehow")
                }

                shouldKeepContents = false

                const topLevelParameters = parameters
                const originalElementChildren = [...element.children]
                for (const index in queryValue.reverse()) {
                  const current = queryValue[index]
                  const parameters: ParameterValue = {
                    ...topLevelParameters,
                    rootSelector: undefined,
                    select: undefined,
                  }
                  setParameterWithSource(
                    parameters,
                    "list",
                    queryValue,
                    "query param",
                  )
                  setParameterWithSource(
                    parameters,
                    "index",
                    index,
                    "query param",
                  )
                  setParameterWithSource(
                    parameters,
                    "currentListItem",
                    current,
                    "query param",
                  )
                  // Even though we're going to place everything in
                  // reverse order (with .after()), start in-order for
                  // imperative templating logic like `set-`
                  const toPlace = []
                  for (const childElement of originalElementChildren) {
                    const childElementClone =
                      childElement.clone() as HTMLElement
                    // This typing is just wrong. Null is perfectly valid
                    childElementClone.parentNode = element.parentNode
                    const { content } = await applyTemplating({
                      fileCache,
                      element: childElementClone,
                      parameters,
                    })
                    toPlace.push(content)
                  }

                  element.after(...toPlace)
                }
              }
              break
            case "debugger":
              debugger
              break
            case "content":
              {
                const queryValue = await getQueryValue(value)
                if (queryValue) {
                  shouldKeepContents = false
                  element.after(
                    typeof queryValue == "string"
                      ? queryValue
                      : (queryValue as Object).toString(),
                  )
                }
              }
              break
            case "if":
              {
                const conditional = !!(await getQueryValue(value))

                if (!conditional) {
                  shouldKeepContents = false
                  break attributes
                }
              }
              break
            default:
              console.error(`Unhandled <render-> attribute ${key}`)
              break
          }
        }
        alreadySetForNextIteration = treeWalker.nextNodeNotChildren()
        if (shouldKeepContents) {
          element.after(element.innerHTML)
        }
        element.remove()
      }
      default:
        break
    }
  } while (alreadySetForNextIteration || treeWalker.nextNode())

  // TODO: Probably at this stage shuold just Object.assign(parameters, meta)
  let selector: string | null =
    meta.noselect !== undefined || parameters.noselect !== undefined
      ? null
      : (maybeStringParameterValue(meta, "select") ??
        maybeStringParameterValue(parameters, "select") ??
        null)
  // Auto-select body if there will be a container
  const autoSelectBody =
    !selector &&
    !(meta.nocontainer !== undefined || parameters.nocontainer !== undefined)
  selector = selector || (autoSelectBody ? "body>*" : null)
  if (selector) {
    if (typeof selector !== "string") {
      throw new Error("query value expected string")
    }
    const body = root.querySelector("body")
    if (body && body.innerHTML.trim().length > 0) {
      return {
        content: body.innerHTML,
        meta,
        links,
      }
    }
    if (!autoSelectBody) {
      throw new QueryError(
        400,
        `parameters.select: '${selector}' did not match any elements`,
      )
    }
    return { content: root.toString(), meta, links }
  }

  return { content: root.toString(), meta, links }
}

export type Filter = (
  node: Node,
) =>
  | NodeFilter["FILTER_ACCEPT"]
  | NodeFilter["FILTER_REJECT"]
  | NodeFilter["FILTER_SKIP"]
// Playing with implementing Treewalker https://developer.mozilla.org/en-US/docs/Web/API/TreeWalker
export class TreeWalker {
  root: Node
  currentNode: Node
  whatToShow: number
  filter: Filter
  constructor(
    root: Node,
    whatToShow: number = NodeFilter.SHOW_ALL,
    filter: Filter = () => NodeFilter.FILTER_ACCEPT,
  ) {
    this.root = root
    this.currentNode = root
    this.whatToShow = whatToShow
    this.filter = filter
  }

  parentNode() {
    if (this.currentNode === this.root) return null
    let node = this.currentNode.parentNode
    while (node) {
      if (this.visible(node)) {
        this.currentNode = node
        return node
      }
      node = node.parentNode
    }

    return null
  }

  firstChild() {
    for (const node of this.currentNode.childNodes) {
      if (this.visible(node)) {
        this.currentNode = node
        return node
      }
    }

    return null
  }

  lastChild() {
    for (const node of this.currentNode.childNodes.reverse()) {
      if (this.visible(node)) {
        this.currentNode = node
        return node
      }
    }

    return null
  }

  nextSibling(): Node | null {
    if (this.currentNode === this.root) return null
    let i = 0
    if (!this.currentNode.parentNode) return null
    const generation = this.currentNode.parentNode.childNodes
    while (i < generation.length) {
      if (generation[i++] === this.currentNode) break
    }

    while (i < generation.length) {
      const node = generation[i++]
      if (this.visible(node)) {
        this.currentNode = node
        return node
      }
    }

    return null
  }

  previousSibling(): Node | null {
    if (this.currentNode === this.root) return null
    let i = 0
    if (!this.currentNode.parentNode) return null
    const generation = this.currentNode.parentNode.childNodes.reverse()
    while (i < generation.length) {
      if (generation[i++] === this.currentNode) break
    }

    while (i < generation.length) {
      const node = generation[i++]
      if (this.visible(node)) {
        this.currentNode = node
        return node
      }
    }

    return null
  }

  // Depth first
  nextNode(): Node | null {
    if (this.firstChild()) return this.currentNode
    if (this.nextSibling()) return this.currentNode
    while (this.parentNode()) {
      if (this.nextSibling()) return this.currentNode
    }
    return null
  }

  previousNode(): Node | null {
    if (this.previousSibling()) return this.currentNode
    if (this.parentNode()) return this.currentNode
    return null
  }

  /**
   * Useful for skipping a node's contents, e.g. when it is to be removed
   **/
  nextNodeNotChildren(): Node | null {
    if (this.nextSibling()) return this.currentNode
    while (this.parentNode()) {
      if (this.nextSibling()) return this.currentNode
    }
    return null
  }

  private visible(node: Node): boolean {
    const f = this.whatToShow
    const nf = NodeFilter
    const nt = node.nodeType
    const NT = NodeType
    if (f === nf.SHOW_ALL) return true
    if (isSet(f, nf.SHOW_ELEMENT) && nt == NT.ELEMENT_NODE) return true
    if (isSet(f, nf.SHOW_ELEMENT) && nt == NT.ELEMENT_NODE) return true
    if (isSet(f, nf.SHOW_TEXT) && nt == NT.TEXT_NODE) return true
    if (isSet(f, nf.SHOW_COMMENT) && nt == NT.COMMENT_NODE) return true

    return false
  }
}

function isSet(what: number, mask: NodeFilter[keyof NodeFilter]): boolean {
  return (what & mask) === mask
}

// Taken from https://gist.github.com/kindy/eb7e2581265fb80aae11ab50f668ec20#file-polyfill-document-createtreewalker-js-L27
export const NodeFilter = {
  // Constants for acceptNode()
  FILTER_ACCEPT: 1,
  FILTER_REJECT: 2,
  FILTER_SKIP: 3,

  // Constants for whatToShow
  SHOW_ALL: 0xffffffff,
  SHOW_ELEMENT: 0x1,
  SHOW_ATTRIBUTE: 0x2, // historical
  SHOW_TEXT: 0x4,
  SHOW_CDATA_SECTION: 0x8, // historical
  SHOW_ENTITY_REFERENCE: 0x10, // historical
  SHOW_ENTITY: 0x20, // historical
  SHOW_PROCESSING_INSTRUCTION: 0x40,
  SHOW_COMMENT: 0x80,
  SHOW_DOCUMENT: 0x100,
  SHOW_DOCUMENT_TYPE: 0x200,
  SHOW_DOCUMENT_FRAGMENT: 0x400,
  SHOW_NOTATION: 0x800, // historical
} as const
export type NodeFilter = typeof NodeFilter

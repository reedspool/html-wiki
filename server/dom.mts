import { type Node, NodeType, HTMLElement } from "node-html-parser";
import { parse as parseHtml } from "node-html-parser";
import { QueryError } from "./error.mts";
import { pString } from "./queryLanguage.mts";
import {
    type ParameterValue,
    setEachParameterWithSource,
    setParameterChildrenWithSource,
    setParameterWithSource,
} from "./engine.mts";
import debug from "debug";
const log = debug("server:dom");
export type Meta = Record<string, string | string[]>;

export const applyTemplating = async (
    params: {
        parameters: ParameterValue;
        topLevelParameters: ParameterValue;
        stopAtSelector?: string;
    } & (
        | {
              content: string;
          }
        | {
              element: HTMLElement;
          }
    ),
): Promise<{
    content: string;
    meta: Meta;
}> => {
    const { parameters, topLevelParameters, stopAtSelector } = params;
    const getQueryValue = (query: string) => {
        return pString(query, { parameters, topLevelParameters });
    };
    const meta: Meta = {};
    let root: HTMLElement;
    if ("content" in params) {
        root = parseHtml(params.content);
    } else if ("element" in params) {
        root = params.element;
    } else {
        throw new Error("element or content is required");
    }
    const treeWalker = new TreeWalker(root, NodeFilter.SHOW_ELEMENT);

    let alreadySetForNextIteration: Node | null = null;
    let stopAtElement: HTMLElement | null = null;

    if (stopAtSelector) {
        stopAtElement = root.querySelector(stopAtSelector);
        if (!stopAtElement)
            throw new Error(
                `Could not find stopAtSelector '${stopAtSelector}'`,
            );
    }
    do {
        alreadySetForNextIteration = null;
        if (treeWalker.currentNode.nodeType !== NodeType.ELEMENT_NODE) {
            throw new Error(
                `Treewalker showed a non-HTMLElement Node '${treeWalker.currentNode}'`,
            );
        }
        const element = treeWalker.currentNode as HTMLElement;
        if (stopAtElement && element === stopAtElement) break;
        switch (element.tagName) {
            case "LINK":
                if (element.attributes.rel === "icon") {
                    meta.favicon = element.attributes.href;
                }
                break;
            case "META":
                switch (element.attributes.name) {
                    case "description":
                        meta[element.attributes.name] =
                            element.attributes.content;
                        break;
                    case undefined:
                        break;
                    default:
                        break;
                }
                switch (element.attributes.itemprop) {
                    case undefined:
                        break;
                    case "tag":
                    case "tags":
                        if (!meta.tags) meta.tags = [];
                        (meta.tags as string[]).push(
                            ...element.attributes.content
                                .trim()
                                .split(/\s*,\s*/),
                        );
                        break;
                    default:
                        meta[element.attributes.itemprop] =
                            element.attributes.content;
                        break;
                }

                break;
            case "TITLE":
                meta.title = element.innerText;
                break;
            case "SLOT":
                switch (element.attributes.name) {
                    case "keep":
                    case "remove":
                        {
                            // The rules are exactly inverted between keep and remove
                            let shouldRemove =
                                element.attributes.name === "remove";
                            switch (element.attributes.if) {
                                case "raw":
                                    if (
                                        !(await getQueryValue("parameters.raw"))
                                    ) {
                                        shouldRemove = !shouldRemove;
                                    }
                                    break;
                                case undefined:
                                    break;
                                default:
                                    break;
                            }
                            if (shouldRemove) {
                                alreadySetForNextIteration =
                                    treeWalker.nextNodeNotChildren();
                                element.remove();
                            } else {
                                alreadySetForNextIteration =
                                    treeWalker.nextNode();
                                element.childNodes.reverse().forEach((node) => {
                                    element.after(node);
                                });
                                element.remove();
                            }
                        }
                        break;
                    default:
                        log(
                            `Failed to handle slot named '${element.attributes.name}' `,
                        );
                        break;
                }

                break;
            case "MAP-LIST":
                {
                    const query = element.getAttribute("q");
                    if (!query) {
                        throw new QueryError(
                            500,
                            `map-list must have 'q' with a query as value, got value ${query}`,
                        );
                    }

                    let queryValue = await getQueryValue(query);
                    if (!Array.isArray(queryValue)) {
                        if (element.hasAttribute("allow-one")) {
                            queryValue = [queryValue];
                        } else {
                            throw new Error(
                                "Expected an array value for map-list",
                            );
                        }
                    }
                    if (!Array.isArray(queryValue)) {
                        throw new Error("Shouldn't have gotten here");
                    }
                    alreadySetForNextIteration =
                        treeWalker.nextNodeNotChildren();
                    // TODO: apply templating here to children
                    for (const index in queryValue.reverse()) {
                        const current = queryValue[index];
                        const parameters: ParameterValue = {};
                        setParameterWithSource(
                            parameters,
                            "list",
                            queryValue,
                            "query param",
                        );
                        setParameterWithSource(
                            parameters,
                            "index",
                            index,
                            "query param",
                        );
                        setParameterWithSource(
                            parameters,
                            "currentListItem",
                            current,
                            "query param",
                        );
                        for (const childElement of element.children.reverse()) {
                            // This needs to be a clone for two reasons.
                            // First it needs to be detached from the parent
                            // so that it doesn't continue to try to
                            // traverse outside. Thsi could be achieved
                            // alternatively by implementing "stopAt"
                            // parameter for applyTemplate, which might be
                            // useful for other reasons. But since this also
                            // needs t obe a clone for the second reason (as
                            // the nth copy to fill in with the nth list
                            // item's data), it works.
                            const childElementClone =
                                childElement.clone() as HTMLElement;
                            // This typing is just wrong. Null is perfectly valid
                            //@ts-expect-error
                            childElementClone.parentNode = null;
                            const { content } = await applyTemplating({
                                element: childElementClone,
                                parameters: parameters,
                                topLevelParameters,
                            });
                            element.after(content);
                        }
                    }
                    element.remove();
                }
                break;
            case "REPLACE-WITH":
                {
                    const attributeEntries = Object.entries(element.attributes);
                    const tagName = attributeEntries[0][0];
                    if (attributeEntries[0][1]) {
                        throw new QueryError(
                            500,
                            `replace-with first attribute must be a tagName with no value, got value ${attributeEntries[0][1]}`,
                        );
                    }

                    const replacementElement = new HTMLElement(tagName, {});
                    replacementElement.innerHTML = element.innerHTML;

                    for (let i = 1; i < attributeEntries.length; i++) {
                        const [key, value] = attributeEntries[i];
                        const match = key.match(/^x-(.*)$/);
                        if (match) {
                            const realKey = match[1];
                            const queryValue = await getQueryValue(value);
                            switch (realKey) {
                                case "content":
                                    if (typeof queryValue !== "string") {
                                        if (
                                            typeof (queryValue as object)?.[
                                                "toString"
                                            ] === "function"
                                        ) {
                                            replacementElement.innerHTML = (
                                                queryValue as object
                                            ).toString();
                                        } else {
                                            replacementElement.innerHTML =
                                                "&lt;unstringable value&gt;";
                                        }
                                    } else {
                                        replacementElement.innerHTML =
                                            queryValue;
                                    }
                                    break;
                                default:
                                    replacementElement.setAttribute(
                                        realKey,
                                        typeof queryValue === "string"
                                            ? queryValue
                                            : String(queryValue),
                                    );
                                    break;
                            }
                        } else {
                            replacementElement.setAttribute(key, value);
                        }
                    }
                    alreadySetForNextIteration =
                        treeWalker.nextNodeNotChildren();
                    element.replaceWith(replacementElement);
                }
                break;
            case "QUERY-CONTENT":
                {
                    const attributeEntries = Object.entries(element.attributes);
                    if (attributeEntries[0][0] !== "q") {
                        throw new QueryError(
                            500,
                            "query-content only supports a single attribute, `q` whose value is the query to use to replace ",
                        );
                    }
                    if (typeof attributeEntries[0][1] !== "string") {
                        throw new QueryError(
                            500,
                            `query-content first attribute must be 'q' with a query as value, got value ${attributeEntries[0][1]}`,
                        );
                    }
                    const query = attributeEntries[0][1];

                    let queryValue = await getQueryValue(query);
                    if (!queryValue) {
                        queryValue = element.innerHTML;
                    }
                    if (typeof queryValue !== "string") {
                        throw new Error("query value expected string");
                    }
                    alreadySetForNextIteration =
                        treeWalker.nextNodeNotChildren();
                    element.after(queryValue);
                    element.remove();
                }
                break;
            case "SET-":
                {
                    const attributeEntries = Object.entries(element.attributes);
                    const [parameterName, query] = attributeEntries[0];

                    let queryValue = await getQueryValue(query);
                    // TODO: This sets the parameter for everything after this,
                    // but it would be cool if parameters were a scope concept
                    // and this could createa new scope only for the processing
                    // of the contents of this tag
                    setParameterWithSource(
                        topLevelParameters,
                        parameterName,
                        queryValue,
                        "query param",
                    );
                }
                break;
            case "DROP-IF":
            case "KEEP-IF":
                {
                    let shouldDrop = element.tagName === "DROP-IF";
                    const attributeEntries = Object.entries(element.attributes);
                    if (attributeEntries.length > 1) {
                        throw new Error(
                            "drop-/keep-if require exactly one attribute",
                        );
                    }
                    const conditionalKey = attributeEntries[0][0];
                    const value = attributeEntries[0][1];

                    let conditional = false;
                    switch (conditionalKey) {
                        case "falsy": {
                            conditional = !(await getQueryValue(value));
                        }
                        case "truthy":
                            {
                                conditional = !!(await getQueryValue(value));
                            }
                            break;
                        default:
                            throw new Error(
                                `Couldn't comprehend conditional attribute ${conditionalKey}`,
                            );
                    }

                    if (!conditional) shouldDrop = !shouldDrop;
                    if (shouldDrop) {
                        alreadySetForNextIteration =
                            treeWalker.nextNodeNotChildren();
                    } else {
                        alreadySetForNextIteration = treeWalker.nextNode();
                        for (const childNode of element.childNodes.reverse()) {
                            element.after(childNode);
                        }
                    }
                    element.remove();
                }
                break;
            default:
                break;
        }
    } while (alreadySetForNextIteration || treeWalker.nextNode());

    const selector = await getQueryValue("parameters.select");
    if (selector) {
        if (typeof selector !== "string") {
            throw new Error("query value expected string");
        }
        const selected = root.querySelector(selector);
        if (!selected)
            throw new QueryError(
                400,
                `selector ${selector} did not match any elements`,
            );
        return { content: selected.innerHTML.toString(), meta };
    }

    return { content: root.toString(), meta };
};

export type Filter = (
    node: Node,
) =>
    | NodeFilter["FILTER_ACCEPT"]
    | NodeFilter["FILTER_REJECT"]
    | NodeFilter["FILTER_SKIP"];
// Playing with implementing Treewalker https://developer.mozilla.org/en-US/docs/Web/API/TreeWalker
export class TreeWalker {
    currentNode: Node;
    whatToShow: number;
    filter: Filter;
    constructor(
        root: Node,
        whatToShow: number = NodeFilter.SHOW_ALL,
        filter: Filter = () => NodeFilter.FILTER_ACCEPT,
    ) {
        this.currentNode = root;
        this.whatToShow = whatToShow;
        this.filter = filter;
    }

    parentNode() {
        let node = this.currentNode.parentNode;
        while (node) {
            if (this.visible(node)) {
                this.currentNode = node;
                return node;
            }
            node = node.parentNode;
        }

        return null;
    }

    firstChild() {
        for (const node of this.currentNode.childNodes) {
            if (this.visible(node)) {
                this.currentNode = node;
                return node;
            }
        }

        return null;
    }

    lastChild() {
        for (const node of this.currentNode.childNodes.reverse()) {
            if (this.visible(node)) {
                this.currentNode = node;
                return node;
            }
        }

        return null;
    }

    nextSibling(): Node | null {
        let i = 0;
        if (!this.currentNode.parentNode) return null;
        const generation = this.currentNode.parentNode.childNodes;
        while (i < generation.length) {
            if (generation[i++] === this.currentNode) break;
        }

        while (i < generation.length) {
            const node = generation[i++];
            if (this.visible(node)) {
                this.currentNode = node;
                return node;
            }
        }

        return null;
    }

    previousSibling(): Node | null {
        let i = 0;
        if (!this.currentNode.parentNode) return null;
        const generation = this.currentNode.parentNode.childNodes.reverse();
        while (i < generation.length) {
            if (generation[i++] === this.currentNode) break;
        }

        while (i < generation.length) {
            const node = generation[i++];
            if (this.visible(node)) {
                this.currentNode = node;
                return node;
            }
        }

        return null;
    }

    // Depth first
    nextNode(): Node | null {
        if (this.firstChild()) return this.currentNode;
        if (this.nextSibling()) return this.currentNode;
        while (this.parentNode()) {
            if (this.nextSibling()) return this.currentNode;
        }
        return null;
    }

    previousNode(): Node | null {
        if (this.previousSibling()) return this.currentNode;
        if (this.parentNode()) return this.currentNode;
        return null;
    }

    /**
     * Useful for skipping a node's contents, e.g. when it is to be removed
     **/
    nextNodeNotChildren(): Node | null {
        if (this.nextSibling()) return this.currentNode;
        while (this.parentNode()) {
            if (this.nextSibling()) return this.currentNode;
        }
        return null;
    }

    private visible(node: Node): boolean {
        const f = this.whatToShow;
        const nf = NodeFilter;
        const nt = node.nodeType;
        const NT = NodeType;
        if (f === nf.SHOW_ALL) return true;
        if (isSet(f, nf.SHOW_ELEMENT) && nt == NT.ELEMENT_NODE) return true;
        if (isSet(f, nf.SHOW_ELEMENT) && nt == NT.ELEMENT_NODE) return true;
        if (isSet(f, nf.SHOW_TEXT) && nt == NT.TEXT_NODE) return true;
        if (isSet(f, nf.SHOW_COMMENT) && nt == NT.COMMENT_NODE) return true;

        return false;
    }
}

function isSet(what: number, mask: NodeFilter[keyof NodeFilter]): boolean {
    return (what & mask) === mask;
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
} as const;
export type NodeFilter = typeof NodeFilter;

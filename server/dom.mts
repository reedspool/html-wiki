import { type Node, NodeType, HTMLElement, TextNode } from "node-html-parser";
import { parse as parseHtml } from "node-html-parser";
import { escapeHtml, renderMarkdown } from "./utilities.mts";
export type Operations = {
    serverError: (message: string) => void;
    getEntryFileName: () => string;
    getQueryValue: (query: string) => Promise<string>;
    setContentType: (type: string, fileRoot: HTMLElement) => void;
    select?: string;
};

export const applyTemplating = async (contents: string, ops: Operations) => {
    const root = parseHtml(contents);
    const treeWalker = new TreeWalker(root, NodeFilter.SHOW_ELEMENT);

    do {
        if (treeWalker.currentNode.nodeType !== NodeType.ELEMENT_NODE) {
            throw new Error(
                `Treewalker showed a non-HTMLElement Node '${treeWalker.currentNode}'`,
            );
        }
        const element = treeWalker.currentNode as HTMLElement;
        switch (element.tagName) {
            case "META":
                switch (element.attributes.itemprop) {
                    case undefined:
                        break;
                    case "content-type":
                        switch (element.attributes.content) {
                            case "markdown":
                                const body = (
                                    root as HTMLElement
                                ).querySelector("body");
                                const markdownContent =
                                    body?.querySelector("code > pre");
                                if (!body) {
                                    ops.serverError(
                                        `No <body> found in file ${escapeHtml(ops.getEntryFileName())}`,
                                    );
                                    return;
                                }
                                if (!markdownContent) {
                                    ops.serverError(
                                        `No <code><pre> sequence found in file ${escapeHtml(ops.getEntryFileName())}`,
                                    );
                                    return;
                                }
                                body.innerHTML = renderMarkdown(
                                    markdownContent.innerHTML,
                                );
                                break;
                            default:
                                console.error(
                                    `Failed to handle content-type '${element.attributes.content}' `,
                                );
                                break;
                        }
                        break;
                    default:
                        console.error(
                            `Failed to handle meta itemprop '${element.attributes.itemprop}' `,
                        );
                        break;
                }

                break;
            case "SLOT":
                switch (element.attributes.name) {
                    case "content":
                        const fileToEditContents =
                            await ops.getQueryValue("fileToEditContents");
                        if (!fileToEditContents) break;
                        const text = new TextNode(
                            escapeHtml(fileToEditContents),
                        );
                        element.replaceWith(text);
                        treeWalker.currentNode = text;
                        break;
                    case "keep":
                    case "remove":
                        {
                            // The rules are exactly inverted between keep and remove
                            let shouldRemove =
                                element.attributes.name === "remove";
                            switch (element.attributes.if) {
                                case "raw":
                                    if (
                                        !(await ops.getQueryValue(
                                            "q/query/raw",
                                        ))
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
                                // Note: .remove() and event .replaceWith("") produce an
                                // empty line with extra whitespace
                                element.innerHTML = "";
                                // element.parentNode.removeChild(slotElement);
                            } else {
                                // TODO: Ideally we replace the slot with its contents, but I can't think of a good way to do that
                                // that doesn't have the same issue of introducing extra whitespace
                                // Note that some extra whitespace might be intentional! But my HTML validator currently doesn't like it
                                // and I want to keep it that way
                                element.childNodes.forEach((node) => {
                                    element.after(node);
                                });
                                element.innerHTML = "";
                            }
                        }
                        break;
                    case "entry-link":
                        const replacementElement = new HTMLElement("a", {});
                        replacementElement.setAttribute(
                            "href",
                            `/${await ops.getEntryFileName()}`,
                        );
                        replacementElement.innerHTML =
                            await ops.getEntryFileName();
                        element.replaceWith(replacementElement);
                        treeWalker.currentNode = replacementElement;
                        break;
                    default:
                        console.error(
                            `Failed to handle slot named '${element.attributes.name}' `,
                        );
                        break;
                }

                break;
            case "REPLACE-WITH":
                {
                    const attributeEntries = Object.entries(element.attributes);
                    const tagName = attributeEntries[0][0];
                    if (attributeEntries[0][1]) {
                        ops.serverError(
                            `replace-with first attribute must be a tagName with no value, got value ${attributeEntries[0][1]}`,
                        );
                        return;
                    }
                    const replacementElement = new HTMLElement(tagName, {});

                    for (let i = 1; i < attributeEntries.length; i++) {
                        const [key, value] = attributeEntries[i];
                        const match = key.match(/^x-(.*)$/);
                        if (match) {
                            const realKey = match[1];
                            const queryValue = await ops.getQueryValue(value);
                            switch (realKey) {
                                case "content":
                                    replacementElement.innerHTML = queryValue;
                                    break;
                                default:
                                    replacementElement.setAttribute(
                                        realKey,
                                        queryValue,
                                    );
                                    break;
                            }
                        } else {
                            replacementElement.setAttribute(key, value);
                        }
                    }
                    element.replaceWith(replacementElement);
                    treeWalker.currentNode = replacementElement;
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
                            conditional = !(await ops.getQueryValue(value));
                        }
                        case "truthy":
                            {
                                conditional =
                                    !!(await ops.getQueryValue(value));
                            }
                            break;
                        default:
                            throw new Error(
                                `Couldn't comprehend conditional attribute ${conditionalKey}`,
                            );
                    }

                    if (!conditional) shouldDrop = !shouldDrop;
                    if (shouldDrop) element.innerHTML = "";
                }
                break;
            default:
                break;
        }
    } while (treeWalker.nextNode());

    if (ops.select) {
        return root.querySelector(ops.select).innerHTML.toString();
    }

    return root.toString();
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

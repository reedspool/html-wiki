import Watcher from "watcher";
import { resolve } from "path";
import express from "express";
import EventEmitter from "node:events";
import multer from "multer";
import debug from "debug";
import { HTMLElement, NodeType, parse } from "node-html-parser";
import { Temporal } from "temporal-polyfill";
import Fuse from "fuse.js";
import YAML from "yaml";
import { micromark } from "micromark";
import { gfmAutolinkLiteral, gfmAutolinkLiteralHtml } from "micromark-extension-gfm-autolink-literal";
import { gfmFootnote, gfmFootnoteHtml } from "micromark-extension-gfm-footnote";
import { gfmStrikethrough, gfmStrikethroughHtml } from "micromark-extension-gfm-strikethrough";
import { gfmTable, gfmTableHtml } from "micromark-extension-gfm-table";
import { gfmTaskListItem, gfmTaskListItemHtml } from "micromark-extension-gfm-task-list-item";
import { basename, dirname, join, normalize } from "node:path";
import { mkdir, open, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import * as acorn from "acorn";
import * as walk from "acorn-walk";
import * as importWithoutCache from "import-without-cache";
import { contentType } from "mime-types";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { Command } from "@commander-js/extra-typings";
import { format } from "prettier";

//#region server/serverUtilities.mts
const log$5 = debug("server:serverUtilities");
const expressQueryToRecord = (reqQuery) => {
	const query = {};
	for (const key in reqQuery) {
		if (typeof key != "string") throw new Error(`req.query key '${key}' was not a string.`);
		const value = reqQuery[key];
		if (typeof value != "string") {
			log$5(`req.query['${key}'] was not a string: ${reqQuery[key]}`);
			throw new Error(`req.query['${key}'] was not a string. See log`);
		}
		query[key] = value;
	}
	return query;
};
const staticContentTypes = {
	plainText: "text/plain; charset=utf-8",
	arbitraryFile: "application/octet-stream"
};

//#endregion
//#region server/error.mts
var QueryError = class extends Error {
	constructor(status, message, originalError) {
		super(message);
		this.status = status;
		this.originalError = originalError;
	}
};
var MissingFileQueryError = class extends QueryError {
	constructor(missingPath, originalError) {
		super(404, `Couldn't find expected file at '${missingPath}'`, originalError);
		this.missingPath = missingPath;
	}
};
var UsageError = class extends QueryError {
	constructor(message, originalError) {
		super(522, message, originalError);
	}
};
var AnswerError = class extends QueryError {
	constructor(filePath, fileLocation, failingQuery, originalError) {
		const message = `Could not process query '${failingQuery}' on page ${fileLocation.column === void 0 ? `${filePath}:${fileLocation.line}` : `${filePath}:${fileLocation.line}:${fileLocation.column}`}`;
		super(522, message, originalError);
		this.filePath = filePath;
		this.fileLocation = fileLocation;
		this.failingQuery = failingQuery;
	}
};

//#endregion
//#region server/utilities.mts
const escapeHtml = (text) => {
	const htmlEscapeMap = {
		"&": "&amp;",
		"<": "&lt;",
		">": "&gt;",
		"\"": "&quot;",
		"'": "&#039;"
	};
	return text.replace(/[&<>"']/g, (m) => htmlEscapeMap[m] ?? "");
};
const renderMarkdown = (content) => micromark(content, {
	allowDangerousHtml: true,
	extensions: [
		gfmAutolinkLiteral(),
		gfmFootnote(),
		gfmStrikethrough(),
		gfmTable(),
		gfmTaskListItem()
	],
	htmlExtensions: [
		gfmAutolinkLiteralHtml(),
		gfmFootnoteHtml(),
		gfmStrikethroughHtml(),
		gfmTableHtml(),
		gfmTaskListItemHtml()
	]
});
const parseFrontmatter = (content) => {
	if (!/^---\n(.|\n)*\n---\n/.test(content)) return { restOfContent: content };
	const [_, frontmatterText, ...rest] = content.split(/---\n/);
	const restOfContent = rest.join("---\n");
	return {
		frontmatter: YAML.parse(frontmatterText),
		restOfContent
	};
};
const disallowedParameterNames = `break
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
`.split("\n").map((word) => word.trim());
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
function deepFreeze(obj) {
	Object.values(obj).forEach((value) => Object.isFrozen(value) || deepFreeze(value));
	return Object.freeze(obj);
}

//#endregion
//#region server/filesystem.mts
const actualFilePath = ({ contentPath, directory }) => filePath({
	contentPath,
	directory
});
const filePath = ({ contentPath, directory }) => `${directory}${contentPath}`;
const createFileAndDirectories = async ({ contentPath, directory, content }) => {
	assertHappyFilePath(contentPath);
	let fd;
	try {
		await mkdir(filePath({
			contentPath: dirname(contentPath),
			directory
		}), { recursive: true });
		fd = await open(filePath({
			contentPath,
			directory
		}), "wx");
		if (typeof content === "string") content = cleanContent({ content });
		await writeFile(fd, content);
		return content;
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "EEXIST") throw new QueryError(422, `File ${contentPath} already exists`);
		throw error;
	} finally {
		await fd?.close();
	}
};
const readFile$1 = async (params) => {
	const rawResults = await readFileRaw(params);
	return {
		...rawResults,
		content: rawResults.buffer.toString()
	};
};
const readFileRaw = async ({ contentPath, searchDirectories }) => {
	directorySearch: for (const directory of searchDirectories) {
		const path = filePath({
			contentPath,
			directory
		});
		try {
			return {
				buffer: await readFile(path),
				foundInDirectory: directory
			};
		} catch (error) {
			if (error instanceof Error) {
				if ("code" in error && error.code === "ENOENT") continue directorySearch;
			}
			throw error;
		}
	}
	throw new MissingFileQueryError(contentPath);
};
const fileExists = async (params) => {
	try {
		const { foundInDirectory } = await readFileRaw(params);
		return {
			exists: true,
			foundInDirectory
		};
	} catch (error) {
		return { exists: false };
	}
};
const updateFile = async ({ contentPath, directory, content }) => {
	assertHappyFilePath(contentPath);
	try {
		await (await open(filePath({
			contentPath,
			directory
		}), "wx")).close();
		throw new MissingFileQueryError(contentPath);
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "EEXIST") {
			content = cleanContent({ content });
			await writeFile(filePath({
				contentPath,
				directory
			}), content);
			return content;
		}
		throw error;
	}
};
const happyFilePathRegex = () => /[^a-zA-Z0-9\-. _/]/g;
const assertHappyFilePath = (path) => {
	const problems = path.match(happyFilePathRegex());
	if (problems) {
		const chars = problems.map((c) => `'${c}'`).join(", ");
		throw new Error(`Character${problems.length > 1 ? "s" : ""} ${chars} not allowed in filename`);
	}
};
const cleanFilePath = (original) => {
	const cleaned = original.replace(happyFilePathRegex(), "_");
	assertHappyFilePath(cleaned);
	return cleaned;
};
const removeFile = async ({ contentPath, directory }) => {
	try {
		await (await open(filePath({
			contentPath,
			directory
		}), "wx")).close();
		throw new MissingFileQueryError(contentPath);
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "EEXIST") {
			await rm(filePath({
				contentPath,
				directory
			}));
			return;
		}
		throw error;
	}
};
/**
* Return a list of all the unique paths which are accessible in the given
* searchDirectories. Unique means that if the same path can access a file/dir
* in more than one of the directories, only one entry for the that path is
* included which reflects the entry in the earliest searchDirectory.
**/
const listAndMergeAllDirectoryContents = async ({ searchDirectories }) => {
	const seenContentPaths = /* @__PURE__ */ new Set();
	const results = [];
	const resultsForEachDirectory = await Promise.all(searchDirectories.map((directory) => listAllDirectoryContents({ directory })));
	for (const resultsForDirectory of resultsForEachDirectory) for (const result of resultsForDirectory) {
		if (seenContentPaths.has(result.contentPath)) continue;
		seenContentPaths.add(result.contentPath);
		results.push(result);
	}
	return results;
};
const listAllDirectoryContents = async ({ directory }) => {
	const normalizedBaseDirectory = normalize(directory);
	return (await readdir(normalizedBaseDirectory, {
		recursive: true,
		withFileTypes: true
	})).map((dirent) => ({
		name: dirent.name,
		contentPath: `${dirent.parentPath.slice(normalizedBaseDirectory.length)}/${dirent.name}`,
		actualPath: `${dirent.parentPath}/${dirent.name}`,
		type: dirent.isDirectory() ? "directory" : dirent.isFile() ? "file" : "other"
	}));
};
const cleanContent = ({ content }) => content.replaceAll(/\r\n/g, "\n").replaceAll(/[ \t\r]+\n/g, "\n");

//#endregion
//#region server/queryLanguage.mts
if (!importWithoutCache.isSupported) throw new Error("import-without-cache is not supported in this environment.");
importWithoutCache.init({ skipNodeModules: true });
const log$4 = debug("server:queryLanguage");
const p = async (...args) => {
	let lastValue = void 0;
	for (const a of args) {
		if (typeof a === "function") lastValue = a(lastValue);
		else lastValue = a;
		lastValue = await lastValue;
	}
	return lastValue;
};
const siteProxy = ({ fileCache }) => new Proxy({}, { get(_target, prop) {
	switch (prop) {
		case "allFiles": return fileCache.getListOfFilesAndDetails();
		case "fileTree": return fileCache.getContentPathsByDirectoryStructure();
		case "search": return async (query) => {
			return new Fuse(await fileCache.getListOfFilesAndDetails(), {
				isCaseSensitive: false,
				findAllMatches: true,
				minMatchCharLength: 3,
				useExtendedSearch: false,
				ignoreLocation: false,
				ignoreFieldNorm: true,
				keys: [
					"contentPath",
					"originalContent.content",
					"meta.title"
				]
			}).search(query).map(({ item }) => item);
		};
	}
} });
const renderer = ({ parameters: originalParameters, fileCache }) => async (contentPathOrContentTitle, parameters = {}) => {
	const contentFile = fileCache.ensureByContentPathOrContentTitle(contentPathOrContentTitle);
	const contentFileReadResult = contentFile.originalContent;
	const stringified = JSON.stringify(parameters);
	log$4(`Applying in-query templating for '${contentPathOrContentTitle}' original query content query ${stringified.length > 100 ? stringified.slice(0, 100) + "..." : stringified}`);
	const contentPath = parameters.contentPath ?? contentFile.contentPath;
	if (!parameters.contentPath) setParameterWithSource(parameters, "contentPath", contentPath, "derived");
	if (parameters.raw !== void 0) {
		if (parameters.escape !== void 0) return escapeHtml(contentFileReadResult.content);
		return contentFileReadResult.content;
	}
	let content = contentFileReadResult.content;
	if (parameters.renderMarkdown !== void 0 || contentFile.renderability === "markdown") {
		if (typeof contentPath !== "string") throw new Error();
		content = await specialRenderMarkdown({
			content,
			contentPath,
			fileCache
		});
	}
	setParameterWithSource(parameters, "originalParameters", originalParameters, "derived");
	return (await applyTemplating({
		fileCache,
		content,
		parameters
	})).content;
};
const specialRenderMarkdown = async ({ content, contentPath, fileCache }) => {
	const labels = Array.from(content.matchAll(/\[([^\]]+)\]([^(:]|$)/g)).map(([_, label]) => label).filter((label) => /\S/.test(label));
	content += "\n";
	content += "\n";
	content += labels.map((l) => `[${l}]: <${l}> "Auto-generated wikilink"`).join("\n");
	return renderMarkdown(content);
};
const or = (...args) => args.reduce((a, b) => a || b);
const and = (...args) => args.reduce((a, b) => a && b);
const loader = (fileCache, originalContentPath) => async (contentPath) => {
	const file = fileCache.getByContentPathOrContentTitle(contentPath, originalContentPath);
	if (!file) throw new MissingFileQueryError(contentPath, `Could not load ${contentPath}`);
	return await import(file.actualPath, { with: { cache: "no" } });
};
const buildMyServerPStringContext = ({ parameters, fileCache }) => {
	const utilities = {
		fileCache,
		escapeHtml,
		cleanFilePath,
		Temporal,
		load: loader(fileCache, stringParameterValue(parameters, "contentPath")),
		goodHref: (href) => {
			if (parameters.static === void 0) return href;
			const file = fileCache.getByContentPathOrContentTitle(href);
			if (file) return file.contentPath.replace(/\.md$/, ".html");
			return href;
		},
		site: siteProxy({ fileCache }),
		render: renderer({
			fileCache,
			parameters
		}),
		or,
		and,
		answer: (input) => pString(input, buildMyServerPStringContext({
			parameters,
			fileCache
		}))
	};
	return {
		...utilities,
		...parameters,
		parameters,
		utilities,
		delete: void 0
	};
};
const AsyncFunction = async function() {}.constructor;
const pString = async (pArgList, context) => {
	context = {
		...context,
		p
	};
	const parsed = acorn.parseExpressionAt(pArgList, 0, {
		ecmaVersion: "latest",
		allowAwaitOutsideFunction: true
	});
	walk.simple(parsed, { Identifier({ name }) {
		if (!(name in context) && !(name in globalThis)) context[name] = void 0;
	} });
	const args = [];
	const values = [];
	Object.entries(context).forEach(([key, value]) => {
		if (disallowedParameterNames.includes(key)) return;
		args.push(key);
		values.push(value);
	});
	args.push(`return p(${pArgList});`);
	const fn = AsyncFunction(...args);
	Object.defineProperty(fn, "name", { value: "pString anonymous function" });
	return fn(...values);
};

//#endregion
//#region server/dom.mts
debug("server:dom");
const applyTemplating = async (params) => {
	const { parameters, fileCache } = params;
	const getQueryValue = async (query) => {
		try {
			return await pString(query, buildMyServerPStringContext({
				parameters,
				fileCache
			}));
		} catch (error) {
			console.error("ERROR: PARAMETERS:", parameters);
			const location = { line: -1 };
			if (element?.range) {
				const stringifiedContent = "content" in params ? params.content : root.toString();
				const [startPos, _endPos] = element.range;
				location.line = stringifiedContent.slice(0, startPos).matchAll(/\n/g).toArray().length + 1;
				const lastNewline = stringifiedContent.slice(0, startPos).lastIndexOf("\n");
				location.column = lastNewline === -1 ? startPos : startPos - lastNewline - 1;
			}
			throw new AnswerError(parameters.contentPath ?? parameters.contentPathOrContentTitle ?? "anonymous", location, query, error);
		}
	};
	const meta = {};
	const links = [];
	let root;
	if ("content" in params) root = parse(params.content);
	else if ("element" in params) root = params.element;
	else throw new Error("element or content is required");
	let alreadySetForNextIteration = void 0;
	if (maybeStringParameterValue(parameters, "rootSelector")) {
		const selectedRoot = root.querySelector(stringParameterValue(parameters, "rootSelector"));
		if (!selectedRoot) return {
			content: "",
			meta,
			links
		};
		root = selectedRoot;
	}
	const treeWalker = new TreeWalker(root, NodeFilter.SHOW_ELEMENT);
	let element;
	do {
		alreadySetForNextIteration = void 0;
		if (treeWalker.currentNode.nodeType !== NodeType.ELEMENT_NODE) throw new Error(`Treewalker showed a non-HTMLElement Node '${treeWalker.currentNode}'`);
		element = treeWalker.currentNode;
		const attributeEntries = Object.entries(element.attributes);
		for (let i = 0; i < attributeEntries.length; i++) {
			const [key, value] = attributeEntries[i];
			const match = key.match(/^x(-escape)?-(.*)$/);
			if (!match) continue;
			const isEscape = match[1] === "-escape";
			const realKey = match[2];
			const queryValue = await getQueryValue(value);
			element.removeAttribute(match[0]);
			switch (realKey) {
				case "content":
					let valueToSet;
					if (typeof queryValue !== "string") if (typeof queryValue?.["toString"] === "function") valueToSet = queryValue.toString();
					else valueToSet = "&lt;no textual representation&gt;";
					else valueToSet = queryValue;
					if (isEscape) element.innerHTML = escapeHtml(valueToSet);
					else element.innerHTML = valueToSet;
					break;
				default:
					element.setAttribute(realKey, typeof queryValue === "string" ? queryValue : String(queryValue));
					break;
			}
		}
		switch (element.tagName) {
			case "LINK":
				if (element.attributes.rel === "icon") meta.favicon = element.attributes.href;
				break;
			case "META":
				switch (element.attributes.name) {
					case "description":
						meta[element.attributes.name] = element.attributes.content;
						break;
					case void 0: break;
					default: break;
				}
				switch (element.attributes.itemprop) {
					case void 0: break;
					case "tag":
					case "tags":
						if (!meta.tags) meta.tags = [];
						meta.tags.push(...element.attributes.content.trim().split(/\s*,\s*/));
						break;
					case "nocontainer":
						meta.nocontainer = "nocontainer";
						break;
					default:
						meta[element.attributes.itemprop] = element.attributes.content;
						break;
				}
				break;
			case "TITLE":
				meta.title = element.innerText;
				break;
			case "A":
				if (element.attributes.href) {
					links.push(element.attributes.href);
					element.setAttribute("href", await getQueryValue(`'${element.attributes.href.replace("'", "\\'")}', goodHref`));
				}
				break;
			case "DEBUGGER-":
				debugger;
				break;
			case "SET-":
				for (const [parameterName, query] of Object.entries(element.attributes)) setParameterWithSource(parameters, parameterName, await getQueryValue(query), "query param");
				alreadySetForNextIteration = treeWalker.nextNodeNotChildren();
				element.remove();
				break;
			case "DROP-IF":
			case "KEEP-IF":
				{
					let shouldDrop = element.tagName === "DROP-IF";
					const attributeEntries = Object.entries(element.attributes);
					if (attributeEntries.length > 1) throw new Error("drop-/keep-if require exactly one attribute");
					const conditionalKey = attributeEntries[0][0];
					const value = attributeEntries[0][1];
					let conditional = false;
					switch (conditionalKey) {
						case "falsy": conditional = !await getQueryValue(value);
						case "truthy":
							conditional = !!await getQueryValue(value);
							break;
						default: throw new UsageError(`drop-if can only have 'truthy' or 'falsy' attributes but found '${conditionalKey}'`);
					}
					if (!conditional) shouldDrop = !shouldDrop;
					if (shouldDrop) alreadySetForNextIteration = treeWalker.nextNodeNotChildren();
					else {
						alreadySetForNextIteration = treeWalker.nextNode();
						for (const childNode of element.childNodes.reverse()) element.after(childNode);
					}
					element.remove();
				}
				break;
			case "RENDER-":
			case "R-":
				{
					const attributeEntries = Object.entries(element.attributes);
					let shouldEvaluateChildren = true;
					let shouldKeepContents = true;
					if (element.hasAttribute("map") && element.hasAttribute("content")) throw new Error("Can only use one of map or content in render-");
					attributes: for (const [key, value] of attributeEntries) switch (key) {
						case "map":
							{
								let queryValue = await getQueryValue(value);
								if (!Array.isArray(queryValue)) if (queryValue === void 0 || queryValue === null) queryValue = [];
								else if (element.hasAttribute("allow-one")) queryValue = [queryValue];
								else throw new Error("Expected an array value for <render- /> map attribute");
								if (!Array.isArray(queryValue)) throw new Error("Map value was not an array somehow");
								shouldKeepContents = false;
								shouldEvaluateChildren = false;
								const topLevelParameters = parameters;
								const originalElementChildren = [...element.children];
								for (let index = queryValue.length - 1; index >= 0; index--) {
									const current = queryValue[index];
									const parameters = {
										...topLevelParameters,
										rootSelector: void 0,
										select: void 0
									};
									setParameterWithSource(parameters, "list", queryValue, "query param");
									setParameterWithSource(parameters, "index", index, "query param");
									setParameterWithSource(parameters, element.hasAttribute("item") ? element.getAttribute("item") : "item", current, "query param");
									const temporaryParent = new HTMLElement("div", {});
									temporaryParent.append(...originalElementChildren.map((child) => child.clone()));
									setParameterWithSource(parameters, "innerHTML", true, "query param");
									const { content } = await applyTemplating({
										fileCache,
										element: temporaryParent,
										parameters
									});
									element.after(content);
								}
							}
							break;
						case "debugger":
							debugger;
							break;
						case "content":
							{
								const queryValue = await getQueryValue(value);
								if (queryValue) {
									shouldKeepContents = false;
									shouldEvaluateChildren = false;
									element.after(typeof queryValue == "string" ? queryValue : queryValue.toString());
								}
							}
							break;
						case "if":
							if (!!!await getQueryValue(value)) {
								shouldKeepContents = false;
								shouldEvaluateChildren = false;
								break attributes;
							}
							break;
						default:
							console.error(`Unhandled <render-> attribute ${key}`);
							break;
					}
					if (shouldEvaluateChildren) alreadySetForNextIteration = treeWalker.nextNode();
					else alreadySetForNextIteration = treeWalker.nextNodeNotChildren();
					if (shouldKeepContents) element.after(...element.childNodes);
					element.remove();
				}
				break;
			default: break;
		}
		if (alreadySetForNextIteration === null) break;
	} while (alreadySetForNextIteration || treeWalker.nextNode());
	let selector = maybeStringParameterValue(meta, "select") ?? maybeStringParameterValue(parameters, "select") ?? null;
	const autoSelectBody = !selector && meta.nocontainer === void 0 && parameters.nocontainer === void 0 && root.querySelector("body");
	const takeInnerHTML = autoSelectBody || meta.innerHTML !== void 0 || parameters.innerHTML !== void 0;
	selector = selector || (autoSelectBody ? "body" : null);
	if (selector) {
		if (typeof selector !== "string") throw new Error("query value expected string");
		const selected = root.querySelector(selector);
		if (selected) return {
			content: takeInnerHTML ? selected.innerHTML : selected.toString(),
			meta,
			links
		};
		if (!autoSelectBody) throw new QueryError(400, `parameters.select: '${selector}' did not match any elements`);
		return {
			content: "",
			meta,
			links
		};
	}
	return {
		content: takeInnerHTML ? root.innerHTML : root.toString(),
		meta,
		links
	};
};
var TreeWalker = class {
	constructor(root, whatToShow = NodeFilter.SHOW_ALL, filter = () => NodeFilter.FILTER_ACCEPT) {
		this.root = root;
		this.currentNode = root;
		this.whatToShow = whatToShow;
		this.filter = filter;
	}
	parentNode() {
		if (this.currentNode === this.root) return null;
		let node = this.currentNode.parentNode;
		while (node && node !== this.root) {
			if (this.visible(node)) {
				this.currentNode = node;
				return node;
			}
			node = node.parentNode;
		}
		return null;
	}
	firstChild() {
		for (const node of this.currentNode.childNodes) if (this.visible(node)) {
			this.currentNode = node;
			return node;
		}
		return null;
	}
	lastChild() {
		for (const node of this.currentNode.childNodes.reverse()) if (this.visible(node)) {
			this.currentNode = node;
			return node;
		}
		return null;
	}
	nextSibling() {
		if (this.currentNode === this.root) return null;
		let i = 0;
		if (!this.currentNode.parentNode) return null;
		const generation = this.currentNode.parentNode.childNodes;
		while (i < generation.length) if (generation[i++] === this.currentNode) break;
		while (i < generation.length) {
			const node = generation[i++];
			if (this.visible(node)) {
				this.currentNode = node;
				return node;
			}
		}
		return null;
	}
	previousSibling() {
		if (this.currentNode === this.root) return null;
		let i = 0;
		if (!this.currentNode.parentNode) return null;
		const generation = this.currentNode.parentNode.childNodes.reverse();
		while (i < generation.length) if (generation[i++] === this.currentNode) break;
		while (i < generation.length) {
			const node = generation[i++];
			if (this.visible(node)) {
				this.currentNode = node;
				return node;
			}
		}
		return null;
	}
	nextNode() {
		if (this.firstChild()) return this.currentNode;
		if (this.nextSibling()) return this.currentNode;
		while (this.parentNode()) if (this.nextSibling()) return this.currentNode;
		return null;
	}
	previousNode() {
		if (this.previousSibling()) return this.currentNode;
		if (this.parentNode()) return this.currentNode;
		return null;
	}
	/**
	* Useful for skipping a node's contents, e.g. when it is to be removed
	**/
	nextNodeNotChildren() {
		if (this.nextSibling()) return this.currentNode;
		while (this.parentNode()) if (this.nextSibling()) return this.currentNode;
		return null;
	}
	visible(node) {
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
};
function isSet(what, mask) {
	return (what & mask) === mask;
}
const NodeFilter = {
	FILTER_ACCEPT: 1,
	FILTER_REJECT: 2,
	FILTER_SKIP: 3,
	SHOW_ALL: 4294967295,
	SHOW_ELEMENT: 1,
	SHOW_ATTRIBUTE: 2,
	SHOW_TEXT: 4,
	SHOW_CDATA_SECTION: 8,
	SHOW_ENTITY_REFERENCE: 16,
	SHOW_ENTITY: 32,
	SHOW_PROCESSING_INSTRUCTION: 64,
	SHOW_COMMENT: 128,
	SHOW_DOCUMENT: 256,
	SHOW_DOCUMENT_TYPE: 512,
	SHOW_DOCUMENT_FRAGMENT: 1024,
	SHOW_NOTATION: 2048
};

//#endregion
//#region server/configuration.mts
const __dirname = dirname(fileURLToPath(import.meta.url));
const coreDirectory = `${__dirname}/../entries/core`;
const testDirectory = `${__dirname}/../entries/test`;
const documentationDirectory = `${__dirname}/../entries/documentation`;
const configuredFiles = {
	testDirectory,
	documentationDirectory,
	coreDirectory,
	defaultPageTemplate: "/system/templates/global-page.html",
	markdownPageTemplate: "/system/templates/markdown-page.fragment.html",
	rootIndexHtml: "/index.html",
	testMarkdownFile: "/fixtures/test.md",
	testMarkdownFileWithSpaceInName: "/fixtures/file with a space in the name.md",
	testMarkdownFileWithYamlFrontmatter: "/fixtures/markdown with frontmatter.md",
	testFixtureHtmlFragmentFile: "/fixtures/fixture.fragment.html",
	testHtmlFile: "/fixtures/example.html",
	keywordPageTemplate: "/system/templates/keyword.html",
	searchAndLinkPageTemplate: "/system/actions/search-and-link.html",
	queryPageTemplate: "/system/templates/query.html",
	shortDirectoryName: "/fixtures/shortname",
	defaultDeleteTemplateFile: "/system/templates/delete.html",
	defaultEditTemplateFile: "/system/templates/edit.html",
	defaultCreateTemplateFile: "/system/actions/create.html",
	defaultCreateShadowTemplateFile: "/system/actions/create-shadow.html",
	defaultCssFile: "/system/global.css",
	fileMissingPageTemplate: "/404.html",
	unknownErrorOccurredTemplate: "/system/templates/unknown-error.html",
	sitemapTemplate: "/sitemap.html",
	sharedContentReceiver: "/system/shared-content-receiver.html"
};

//#endregion
//#region server/engine.mts
const log$3 = debug("server:engine");
const Status = {
	ServerError: 500,
	ClientError: 400,
	NotFound: 404,
	OK: 200
};
const execute = async ({ parameters, fileCache }) => {
	log$3("Engine executing parameters: %O", {
		...parameters,
		content: parameters.content ? parameters.content.toString().slice(0, 20) + "..." : void 0
	});
	const validationIssues = [];
	if (!parameters.contentPath && !parameters.contentPathOrContentTitle) validationIssues.push("Exactly one of contentPath or contentPathOrContentTitle required");
	else if (!parameters.contentPath) {
		const contentPathOrContentTitle = stringParameterValue(parameters, "contentPathOrContentTitle");
		const derivedContentPath = fileCache.getByContentPathOrContentTitle(contentPathOrContentTitle)?.contentPath;
		if (!derivedContentPath) throw new MissingFileQueryError(contentPathOrContentTitle);
		else parameters.contentPath = derivedContentPath;
	}
	let command = narrowStringToCommand(stringParameterValue(parameters, "command"));
	if (!command) validationIssues.push(`command must be one of ${commands}`);
	switch (command) {
		case "create":
			if (!parameters.content) validationIssues.push("content required");
			if (stringParameterValue(parameters, "contentPath").charAt(0) !== "/") setParameterWithSource(parameters, "contentPath", "/" + stringParameterValue(parameters, "contentPath"), "derived");
			if (validationIssues.length > 0) return validationErrorResponse(validationIssues);
			await fileCache.createFileAndDirectories({
				contentPath: stringParameterValue(parameters, "contentPath"),
				content: stringOrBufferParameterValue(parameters, "content")
			});
			return {
				status: Status.OK,
				content: `File <a href="${stringParameterValue(parameters, "contentPath")}">${stringParameterValue(parameters, "contentPath")}</a> created successfully`,
				contentPath: stringParameterValue(parameters, "contentPath"),
				contentType: staticContentTypes.plainText
			};
		case "read": {
			if (validationIssues.length > 0) return validationErrorResponse(validationIssues);
			const { originalContent, renderability } = fileCache.ensureByContentPath(stringParameterValue(parameters, "contentPath"));
			let content;
			let nocontainer = parameters.nocontainer !== void 0;
			let customContainerTemplatePath;
			if (parameters.raw !== void 0) if (parameters.escape !== void 0) content = escapeHtml(originalContent.content);
			else content = originalContent.content;
			else {
				let originalContentContent = originalContent.content;
				let isMarkdown = parameters.renderMarkdown !== void 0 || renderability === "markdown";
				if (isMarkdown) {
					const parsed = parseFrontmatter(originalContentContent);
					originalContentContent = parsed.restOfContent;
					if (parsed.frontmatter) setParameterWithSource(parameters, "frontmatter", parsed.frontmatter, "derived");
					if (typeof parameters.contentPath !== "string") throw new Error("Markdown rendering requires contentPath");
					originalContentContent = await specialRenderMarkdown({
						contentPath: parameters.contentPath,
						fileCache,
						content: originalContentContent
					});
				}
				const templateApplicationResults = await applyTemplating({
					fileCache,
					content: originalContentContent,
					parameters
				});
				content = templateApplicationResults.content;
				if (templateApplicationResults.meta.nocontainer) nocontainer = true;
				else if (templateApplicationResults.meta.container) customContainerTemplatePath = templateApplicationResults.meta.container;
				else if (isMarkdown) customContainerTemplatePath = configuredFiles.markdownPageTemplate;
			}
			let resultContentType = contentType(stringParameterValue(parameters, "contentPath").match(/\.[^.]+$/)[0]) || staticContentTypes.plainText;
			if (!nocontainer) {
				const containerExecuteResults = await execute({
					fileCache,
					parameters: {
						originalParameters: parameters,
						title: parameters.title,
						static: parameters.static,
						command: "read",
						contentPath: customContainerTemplatePath ?? configuredFiles.defaultPageTemplate,
						content
					}
				});
				content = containerExecuteResults.content;
				resultContentType = containerExecuteResults.contentType;
			}
			return {
				status: Status.OK,
				content,
				contentType: resultContentType
			};
		}
		case "update":
			if (!parameters.content) validationIssues.push("content required");
			if (validationIssues.length > 0) return validationErrorResponse(validationIssues);
			await fileCache.updateFile({
				contentPath: stringParameterValue(parameters, "contentPath"),
				content: stringParameterValue(parameters, "content")
			});
			return {
				status: Status.OK,
				content: `File <a href="${stringParameterValue(parameters, "contentPath")}">${stringParameterValue(parameters, "contentPath")}</a> updated successfully`,
				contentPath: stringParameterValue(parameters, "contentPath"),
				contentType: staticContentTypes.plainText
			};
		case "delete":
			if (validationIssues.length > 0) return validationErrorResponse(validationIssues);
			await fileCache.removeFile({ contentPath: stringParameterValue(parameters, "contentPath") });
			return {
				status: Status.OK,
				content: `File <a href="${stringParameterValue(parameters, "contentPath")}">${stringParameterValue(parameters, "contentPath")}</a> deleted successfully`,
				contentType: staticContentTypes.plainText
			};
		default: throw new Error(`Unhandled command '${stringParameterValue(parameters, "command")}'`);
	}
};
const validationErrorResponse = (validationIssues) => ({
	status: Status.ClientError,
	content: `Request wasn't valid, issues: ${validationIssues.join("; ")}.`,
	contentType: staticContentTypes.plainText
});
const commands = [
	"create",
	"read",
	"update",
	"delete"
];
const narrowStringToCommand = (maybeCommand) => {
	if (typeof maybeCommand !== "string") return void 0;
	let command;
	for (const cmd of commands) command = maybeCommand == cmd ? maybeCommand : command;
	return command;
};
const setParameterWithSource = (parameters, key, value, source) => {
	if (typeof parameters === "string") throw new Error(`Can't set parameter on ${parameters}`);
	parameters[key];
	parameters[key] = value;
	return parameters;
};
const setEachParameterWithSource = (parameters, record, source) => {
	Object.entries(record).forEach(([key, value]) => {
		setParameterWithSource(parameters, key, value, source);
	});
	return parameters;
};
const stringParameterValue = (parameterV, property) => {
	const parameterVCasted = parameterV;
	const parameter = property in parameterVCasted && parameterVCasted[property];
	if (typeof parameter !== "string") throw new Error(`String required for property '${property}'`);
	return parameter;
};
const stringOrBufferParameterValue = (parameterV, property) => {
	const parameterVCasted = parameterV;
	const parameter = property in parameterVCasted && parameterVCasted[property];
	if (typeof parameter !== "string" && !(parameter instanceof Buffer)) throw new Error(`String or Buffer required for property '${property}'`);
	return parameter;
};
const maybeStringParameterValue = (parameterV, property) => {
	const parameterVCasted = parameterV;
	const parameter = property in parameterVCasted && parameterVCasted[property];
	if (typeof parameter !== "string") return void 0;
	return parameter;
};
const maybeAtLeastEmptyStringParameterValue = (parameterV, property) => {
	const parameter = maybeStringParameterValue(parameterV, property);
	if (parameter === "") return true;
	return parameter;
};

//#endregion
//#region server/server.mts
/**
* Main JS Server
*
* Code comments are sparse, but you're welcome to add them as you learn about
* the system and make a PR!
*/
const log$2 = debug("server:server");
const upload = multer();
const createServer = async ({ port, fileCache }) => {
	const emitter = new EventEmitter();
	emitter.setMaxListeners(100);
	const app = express();
	const baseURL = `localhost:${port}`;
	app.use(express.urlencoded({ extended: true }));
	app.use(upload.none());
	app.use("/", async (req, res, _next) => {
		if (req.path.match(/\.well-known\/appspecific\/com.chrome/)) return;
		let query = expressQueryToRecord(req.query);
		const parameters = {};
		setEachParameterWithSource(parameters, query, "query param");
		setEachParameterWithSource(parameters, req.body ?? {}, "request body");
		let command = narrowStringToCommand(query.command);
		if (command === void 0) {
			if (req.method === "GET") command = "read";
			else if (req.method === "POST") if (query.edit !== void 0) command = "update";
			else if (query.delete !== void 0) command = "delete";
			else if (query.create !== void 0) command = "create";
			else if (req.path === configuredFiles.sharedContentReceiver) {
				command = "read";
				setEachParameterWithSource(parameters, { contentPathOrContentTitle: req.path }, "derived");
			} else command = "update";
			else if (req.method === "PUT") command = "create";
			else if (req.method === "DELETE") {
				command = "delete";
				setParameterWithSource(parameters, "delete-confirm", "true", "derived");
			}
		}
		if (command === void 0) throw new Error(`Unable to derive command from method '${req.method}' and query string`);
		setParameterWithSource(parameters, "command", command, "derived");
		if (stringParameterValue(parameters, "command") == "read" && maybeAtLeastEmptyStringParameterValue(parameters, "edit")) {
			const target = maybeStringParameterValue(parameters, "contentPathOrContentTitle") || req.path;
			const fileExistsResult = fileCache.getByContentPathOrContentTitle(target);
			if (fileExistsResult && fileCache.isCoreFile(fileExistsResult)) {
				setParameterWithSource(parameters, "target", target, "derived");
				setEachParameterWithSource(parameters, {
					contentPath: configuredFiles.defaultCreateShadowTemplateFile,
					target
				}, "derived");
			} else if (fileExistsResult) setEachParameterWithSource(parameters, {
				target: fileExistsResult.contentPath,
				contentPath: configuredFiles.defaultEditTemplateFile
			}, "derived");
			else throw new MissingFileQueryError(target);
		} else if (stringParameterValue(parameters, "command") == "delete" && !maybeAtLeastEmptyStringParameterValue(parameters, "delete-confirm")) {
			res.status(400);
			setParameterWithSource(parameters, "command", "read", "derived");
			command = "read";
			const toDeleteContentPath = maybeStringParameterValue(parameters, "contentPathOrContentTitle") || req.path;
			const fileExistsResult = fileCache.getByContentPathOrContentTitle(toDeleteContentPath);
			if (fileExistsResult && fileCache.isCoreFile(fileExistsResult)) throw new Error(`Can't delete core file ${fileExistsResult.contentPath}`);
			else if (fileExistsResult) setEachParameterWithSource(parameters, {
				target: fileExistsResult.contentPath,
				contentPath: configuredFiles.defaultDeleteTemplateFile
			}, "derived");
			else throw new MissingFileQueryError(toDeleteContentPath);
		}
		if ((command == "update" || command == "create" || command == "delete") && !maybeStringParameterValue(parameters, "contentPathOrContentTitle")) setParameterWithSource(parameters, "contentPathOrContentTitle", req.path, "derived");
		if (!maybeStringParameterValue(parameters, "contentPathOrContentTitle") && !maybeStringParameterValue(parameters, "contentPath")) {
			if (command === "read" && fileCache.getByContentPath(req.path)?.renderability === "static") {
				log$2("Serving static file %s", req.path);
				const readResults = fileCache.ensureByContentPath(req.path).originalContent;
				res.setHeader("Content-Type", contentType(req.path.match(/\.[^.]+$/)[0]) || staticContentTypes.arbitraryFile);
				res.send(readResults.buffer);
				return;
			}
			setEachParameterWithSource(parameters, { contentPathOrContentTitle: req.path }, "derived");
		}
		const result = await execute({
			parameters,
			fileCache
		});
		if (command === "read" || result.status !== Status.OK) {
			res.setHeader("Content-Type", result.contentType);
			if (result.status !== Status.OK) res.status(result.status);
			res.send(result.content);
		} else if (command == "update" || command == "create" || command === "delete") {
			const toWhere = maybeStringParameterValue(parameters, "redirect") !== void 0 ? stringParameterValue(parameters, "redirect") : command === "delete" ? "/" : result.contentPath || "/";
			const params = result.content ? `statusMessage=${result.content}` : "";
			res.redirect(`${toWhere}${toWhere.indexOf("?") === -1 ? "?" : "&"}${params}`);
		} else {
			log$2("Didn't determine what to do with result %o from parameters %O", result, parameters);
			throw new Error("Unexpected state");
		}
	});
	app.use(async function(error, req, res, _next) {
		const parameters = {
			command: "read",
			originalPath: decodeURIComponent(req.path)
		};
		if (error instanceof QueryError) {
			res.status(error.status);
			parameters.originalError = error.originalError;
			parameters.statusCode = error.status;
			if (error instanceof MissingFileQueryError) {
				log$2(`404: While processing request '${req.path}', ${error.message}`);
				parameters.missingPath = error.missingPath;
				parameters.contentPath = configuredFiles.fileMissingPageTemplate;
			} else {
				log$2(`QueryError on ${req.path}:`, error);
				parameters.errorUuid = randomUUID();
				parameters.contentPath = configuredFiles.unknownErrorOccurredTemplate;
				parameters.errorMessage = error.message;
			}
		} else {
			log$2("5XX", { err: error });
			parameters.errorUuid = randomUUID();
			parameters.contentPath = configuredFiles.unknownErrorOccurredTemplate;
			parameters.statusCode = 500;
			res.status(500);
		}
		if (parameters.errorUuid) console.log(`Error UUID: ${parameters.errorUuid}`);
		try {
			const result = await execute({
				parameters,
				fileCache
			});
			res.send(result.content);
		} catch (executeErrorPageError) {
			console.log("Executing error page error: ", executeErrorPageError);
			res.send(`500 Something went seriously wrong :-/${parameters.errorUuid ? ` Error UUID: ${parameters.errorUuid}` : ""}`);
		}
	});
	const listener = app.listen(port, (error) => {
		if (error) {
			if ("code" in error && error.code === "EADDRINUSE") {
				log$2("Port in use, exiting");
				process.exit(1);
			}
			log$2("Error when starting to listen:", error);
			process.exit(1);
		}
		log$2(`Server is available at http://${baseURL}`);
	});
	emitter.on("cleanup", () => {
		listener.close(() => {});
	});
	return { cleanup: () => emitter.emit("cleanup") };
};

//#endregion
//#region server/fileCache.mts
const log$1 = debug("server:fileCache");
const buildEmptyCache = async () => {
	return createFreshCache({ searchDirectories: [] });
};
const createFreshCache = async ({ searchDirectories }) => {
	let listOfFilesAndDetails = [];
	let contentPathsByDirectoryStructure = {};
	let backLinksByContentPath = {};
	let keywordsToContentPaths = {};
	const filesByTitle = {};
	const filesByContentPath = {};
	const addFileToCacheData = async ({ contentPath, rebuildMetaCache = true }) => {
		const everything = await getFileContentsAndMetadata({
			fileCache,
			contentPath,
			searchDirectories
		});
		listOfFilesAndDetails = listOfFilesAndDetails.filter(({ contentPath }) => everything.contentPath !== contentPath);
		listOfFilesAndDetails.push(everything);
		filesByContentPath[everything.contentPath] = everything;
		if (rebuildMetaCache) await fileCache.rebuildMetaCache();
		if (typeof everything.meta.title === "string") filesByTitle[everything.meta.title] = everything;
		else if (everything.meta.title) {
			log$1(`Title must be a string, got %o`, everything.meta.title);
			throw new Error(`Title must be a string, see log`);
		}
	};
	const removeFileFromCacheData = async ({ contentPath }) => {
		listOfFilesAndDetails = listOfFilesAndDetails.filter(({ contentPath: path }) => path !== contentPath);
		const detail = filesByContentPath[contentPath];
		delete filesByContentPath[contentPath];
		if (typeof detail.meta.title === "string") delete filesByTitle[detail.meta.title];
		if ((await fileExists({
			contentPath,
			searchDirectories
		})).exists) await addFileToCacheData({ contentPath });
	};
	const getListOfFilesAndDetails = async () => [...listOfFilesAndDetails];
	const getBacklinksByContentPath = async (path) => {
		const backlinks = backLinksByContentPath[path];
		if (!backlinks) return [];
		return [...backlinks];
	};
	const getContentPathsForKeyword = async (keyword) => {
		const paths = keywordsToContentPaths[keyword];
		if (!paths) return [];
		return [...paths];
	};
	const allKeywords = async () => Object.keys(keywordsToContentPaths);
	const rebuildMetaCache = async () => {
		let contentPathsByDirectoryStructureTmp = {};
		keywordsToContentPaths = {};
		backLinksByContentPath = {};
		for (const { contentPath: sourceContentPath, links, meta: { keywords } } of await getListOfFilesAndDetails()) {
			for (const keyword of keywords ?? []) {
				if (!keywordsToContentPaths[keyword]) keywordsToContentPaths[keyword] = [];
				keywordsToContentPaths[keyword].push(sourceContentPath);
			}
			for (const link of links) {
				const byTitle = fileCache.getByContentPathOrContentTitle(link);
				const destinationContentPath = byTitle ? byTitle.contentPath : link;
				if (!backLinksByContentPath[destinationContentPath]) backLinksByContentPath[destinationContentPath] = [];
				backLinksByContentPath[destinationContentPath].push(sourceContentPath);
			}
			const directoryStructure = sourceContentPath.split("/").slice(1, -1);
			if (directoryStructure.length < 1) contentPathsByDirectoryStructureTmp[sourceContentPath] = sourceContentPath;
			else {
				let currentDirectoryLevel = contentPathsByDirectoryStructureTmp;
				for (const directory of directoryStructure) if (directory in currentDirectoryLevel) if (typeof currentDirectoryLevel[directory] === "string") {
					console.error({
						message: "Expected directory to be object",
						directory,
						currentDirectoryLevel
					});
					throw new Error("Name conflict between directory and filename");
				} else currentDirectoryLevel = currentDirectoryLevel[directory];
				else currentDirectoryLevel = currentDirectoryLevel[directory] = {};
				currentDirectoryLevel[sourceContentPath] = sourceContentPath;
			}
		}
		contentPathsByDirectoryStructure = deepFreeze(contentPathsByDirectoryStructureTmp);
	};
	const getContentPathsByDirectoryStructure = async () => contentPathsByDirectoryStructure;
	const getByContentPathOrContentTitle = (pathOrTitle, originalPath) => {
		return pathOrTitle === "/" ? filesByContentPath["/index.html"] : filesByTitle[decodeURIComponent(pathOrTitle).replace(/^\//, "")] ?? filesByContentPath[decodeURIComponent(pathOrTitle)] ?? (originalPath && filesByContentPath[join(dirname(originalPath), decodeURIComponent(pathOrTitle))]) ?? filesByContentPath[decodeURIComponent(pathOrTitle + "/index.html")];
	};
	const fileCache = {
		rebuildMetaCache,
		getListOfFilesAndDetails,
		getContentPathsByDirectoryStructure,
		getContentPathsForKeyword,
		isCoreFile: (fileContentsAndDetails) => fileContentsAndDetails.originalContent.foundInDirectory !== searchDirectories.at(0),
		getBacklinksByContentPath,
		allKeywords,
		addFileToCacheData,
		removeFileFromCacheData,
		getByContentPath: (path) => filesByContentPath[decodeURIComponent(path)],
		getByTitle: (title) => filesByTitle[decodeURIComponent(title)],
		getByContentPathOrContentTitle,
		ensureByContentPathOrContentTitle: (path) => {
			const entry = getByContentPathOrContentTitle(path);
			if (!entry) throw new MissingFileQueryError(path);
			return entry;
		},
		ensureByContentPath: (path) => {
			const entry = filesByContentPath[decodeURIComponent(path)];
			if (!entry) throw new MissingFileQueryError(path);
			return entry;
		},
		fileExists: async (path) => filesByContentPath[path] ? {
			exists: true,
			...filesByContentPath[path].originalContent
		} : { exists: false },
		createFileAndDirectories: async ({ contentPath, content }) => {
			const result = await createFileAndDirectories({
				directory: searchDirectories.at(0),
				contentPath,
				content
			});
			await addFileToCacheData({ contentPath });
			return result;
		},
		updateFile: async ({ contentPath, content }) => {
			const result = await updateFile({
				directory: searchDirectories.at(0),
				contentPath,
				content
			});
			await removeFileFromCacheData({ contentPath });
			await addFileToCacheData({ contentPath });
			return result;
		},
		removeFile: async ({ contentPath }) => {
			const directory = searchDirectories.at(0);
			const existingEntry = filesByContentPath[contentPath];
			if (!existingEntry) throw new MissingFileQueryError(contentPath);
			if (existingEntry.originalContent.foundInDirectory !== directory) throw new Error("Can only delete files in the top-level search directory");
			const result = await removeFile({
				directory,
				contentPath
			});
			await removeFileFromCacheData({ contentPath });
			return result;
		}
	};
	return fileCache;
};
const buildCache = async ({ searchDirectories }) => {
	if (searchDirectories.length === 0) throw new Error("Cache requires non-empty searchDirectories upfront");
	const fileCache = await createFreshCache({ searchDirectories });
	const allFiles = await getContentsAndMetaOfAllFiles({
		fileCache: await buildEmptyCache(),
		searchDirectories
	});
	await Promise.all(allFiles.map(({ contentPath }) => fileCache.addFileToCacheData({
		contentPath,
		rebuildMetaCache: false
	})));
	await fileCache.rebuildMetaCache();
	return fileCache;
};
const getFileContentsAndMetadata = async ({ contentPath, searchDirectories, fileCache }) => {
	const readResults = await readFile$1({
		searchDirectories,
		contentPath
	});
	const stats = await stat(filePath({
		contentPath,
		directory: readResults.foundInDirectory
	}));
	const myStats = {
		accessTimeMs: stats.atimeMs,
		createdTimeMs: stats.ctimeMs,
		modifiedTimeMs: stats.mtimeMs
	};
	const isMarkdown = /\.md$/.test(contentPath);
	if (isMarkdown || /\.html$/.test(contentPath) || /\.fragment\.html$/.test(contentPath)) {
		let content = readResults.content;
		const returnVal = {
			contentPath,
			name: basename(contentPath),
			type: "file",
			actualPath: actualFilePath({
				contentPath,
				directory: readResults.foundInDirectory
			}),
			meta: {},
			originalContent: readResults,
			renderability: "html",
			links: [],
			...myStats
		};
		if (isMarkdown) try {
			returnVal.renderability = "markdown";
			const parsedFrontmatter = parseFrontmatter(content);
			if (parsedFrontmatter.frontmatter) Object.assign(returnVal.meta, parsedFrontmatter.frontmatter);
			const root = parse(renderMarkdown(content));
			const h1 = root.querySelector("h1");
			if (!returnVal.meta.title && h1) returnVal.meta.title = h1.innerText;
			root.querySelectorAll("a").forEach((a) => {
				const href = a.getAttribute("href");
				if (href) returnVal.links.push(href);
			});
		} catch (error) {
			throw new Error(`Couldn't apply templating for '${contentPath}': ${error}`);
		}
		try {
			const result = await applyTemplating({
				fileCache,
				content: readResults.content,
				parameters: {
					rootSelector: "head",
					nocontainer: true,
					contentPath
				}
			});
			Object.assign(returnVal.meta, result.meta);
			returnVal.links.push(...result.links);
			return returnVal;
		} catch (error) {
			console.error("Templating error:", error);
			throw new Error(`Couldn't apply templating for '${contentPath}': ${error}`);
		}
	} else return {
		contentPath,
		name: basename(contentPath),
		type: "file",
		actualPath: actualFilePath({
			contentPath,
			directory: readResults.foundInDirectory
		}),
		originalContent: readResults,
		meta: {},
		renderability: "static",
		links: [],
		...myStats
	};
};
const getContentsAndMetaOfAllFiles = async ({ searchDirectories }) => {
	const allDirents = await listAndMergeAllDirectoryContents({ searchDirectories });
	return Promise.all(allDirents.filter(({ type }) => type === "file"));
};

//#endregion
//#region server/cli.mts
const log = debug("cli:main");
let server;
process.on("SIGINT", (signal) => {
	log(`Signal ${signal} received, shutting down`);
	server.cleanup();
	setTimeout(() => process.exit(0), 150);
});
const getSearchDirectoriesFromOptions = (options) => {
	if (!options.coreDirectory) {
		options.coreDirectory = configuredFiles.coreDirectory;
		log(`No core directory given, using default ${options.coreDirectory}`);
	}
	if (!options.userDirectory) throw new Error("--user-directory option is required");
	const userDirectory = resolve(options.userDirectory);
	const coreDirectory = resolve(options.coreDirectory);
	return {
		userDirectory,
		coreDirectory,
		searchDirectories: [userDirectory, coreDirectory]
	};
};
const program = new Command().description("HTML Wiki command line tool");
program.command("server").description("run web server").option("-c, --core-directory <string>", "where to read core files", "").option("-u, --user-directory <string>", "where to read user files").option("--port <number>").option("--ignore-errors").action(async (options) => {
	const { searchDirectories, userDirectory, coreDirectory } = getSearchDirectoriesFromOptions(options);
	log({
		options,
		searchDirectories,
		userDirectory,
		coreDirectory
	});
	let port;
	if (process.env.PORT !== void 0) {
		port = Number(process.env.PORT);
		log(`Using environment variable port ${port}`);
	} else if (options.port !== void 0) {
		port = Number(options.port);
		log(`Using command line option port ${port}`);
	} else {
		port = 3001;
		log(`Using default port ${port}`);
	}
	if (options.ignoreErrors) ignoreErrors();
	const fileCache = await buildCache({ searchDirectories });
	setupWatcher({ searchDirectories }).on("all", (event, targetPath, targetPathNext) => {
		const directory = targetPath.startsWith(userDirectory) ? userDirectory : coreDirectory;
		const contentPath = targetPath.slice(directory.length);
		log("Watcher event: %o", {
			event,
			targetPath,
			targetPathNext,
			directory,
			contentPath
		});
		switch (event) {
			case "add":
				fileCache.addFileToCacheData({ contentPath });
				break;
			case "unlink":
				fileCache.removeFileFromCacheData({ contentPath });
				break;
			case "change":
				fileCache.addFileToCacheData({ contentPath });
				break;
			default: log("Watcher unhandled event: %o", {
				event,
				targetPath,
				targetPathNext
			});
		}
	});
	server = await createServer({
		port,
		fileCache
	});
});
program.command("generate").description("render and write out a static version of the site").option("-c, --core-directory <string>", "where to read core files", "").option("-u, --user-directory <string>", "where to read user files").option("-o, --out-directory <string>", "where to write files", "./build").option("-f, --format", "format using prettier", true).option("-w, --watch", "watch source files and rebuild", false).action(async (options) => {
	const { searchDirectories, userDirectory, coreDirectory } = getSearchDirectoriesFromOptions(options);
	log({
		options,
		searchDirectories,
		userDirectory,
		coreDirectory
	});
	const outDirectory = resolve(options.outDirectory);
	if (coreDirectory === outDirectory || userDirectory === outDirectory) {
		log("You probaby didn't want to write out exactly where you're reading from");
		process.exit(1);
	}
	const sourceFileCache = await buildCache({ searchDirectories });
	const destinationFileCache = await buildCache({ searchDirectories: [outDirectory] });
	const files = (await sourceFileCache.getListOfFilesAndDetails()).map(({ contentPath }) => contentPath);
	log(`Writing files to ${outDirectory}:`, "\n" + files.join("\n"));
	const writeFile = async (contentPath) => {
		const readParameters = {};
		setEachParameterWithSource(readParameters, {
			contentPath,
			command: "read",
			static: true
		}, "query param");
		let outputPath = contentPath;
		let outputContent;
		const { renderability } = sourceFileCache.getByContentPath(contentPath);
		switch (renderability) {
			case "static":
				outputContent = sourceFileCache.getByContentPath(contentPath)?.originalContent.buffer;
				break;
			case "html":
			case "markdown":
				outputContent = (await execute({
					parameters: readParameters,
					fileCache: sourceFileCache
				})).content;
				if (options.format) try {
					outputContent = await format(outputContent, { parser: "html" });
				} catch (error) {
					console.error(`Error while formatting ${contentPath}, skipping.`);
					console.error(error instanceof Error ? error.message : error);
				}
				if (renderability === "markdown") outputPath = outputPath.replace(/\.md$/, ".html");
				break;
			default: throw new Error(`Renderability unaccounted for: ${renderability}`);
		}
		const writeParameters = {};
		setEachParameterWithSource(writeParameters, {
			contentPath: outputPath,
			content: outputContent,
			command: "create"
		}, "query param");
		await execute({
			parameters: writeParameters,
			fileCache: destinationFileCache
		});
	};
	const fileWritingPromises = files.map(writeFile);
	await Promise.all(fileWritingPromises);
	if (options.watch) {
		searchDirectories.forEach((dir) => console.log(`Watching files in ${resolve(dir)}`));
		setupWatcher({ searchDirectories }).on("all", async (event, targetPath, targetPathNext) => {
			const directory = targetPath.startsWith(userDirectory) ? userDirectory : coreDirectory;
			const contentPath = targetPath.slice(directory.length);
			log("Watcher event: %o", {
				event,
				targetPath,
				targetPathNext,
				directory,
				contentPath
			});
			switch (event) {
				case "add":
					await sourceFileCache.addFileToCacheData({ contentPath });
					await writeFile(contentPath);
					break;
				case "unlink":
					await sourceFileCache.removeFileFromCacheData({ contentPath });
					await execute({
						fileCache: destinationFileCache,
						parameters: {
							command: "delete",
							contentPath
						}
					});
					if (sourceFileCache.getByContentPath(contentPath)) await writeFile(contentPath);
					break;
				case "change":
					await sourceFileCache.removeFileFromCacheData({ contentPath });
					await sourceFileCache.addFileToCacheData({ contentPath });
					await execute({
						fileCache: destinationFileCache,
						parameters: {
							command: "delete",
							contentPath: contentPath.replace(/\.md$/, ".html")
						}
					});
					writeFile(contentPath);
					break;
				default: log("Watcher unhandled event: %o", {
					event,
					targetPath,
					targetPathNext
				});
			}
		});
	}
});
program.parse();
function ignoreErrors() {
	process.on("uncaughtException", function(err) {
		log("Top-level uncaught exception: " + err, err);
	});
	process.on("unhandledRejection", function(err, promise) {
		log("Top level unhandled rejection (promise: ", promise, ", reason: ", err, ").", err);
	});
}
const setupWatcher = ({ searchDirectories }) => new Watcher(searchDirectories, {
	recursive: true,
	ignoreInitial: true
});

//#endregion
export {  };
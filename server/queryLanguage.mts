import { Temporal } from "temporal-polyfill";
import Fuse from "fuse.js";
import { readFile } from "./filesystem.mts";
import {
    listNonDirectoryFiles,
    maybeStringParameterValue,
    setEachParameterWithSource,
    type ParameterValue,
} from "./engine.mts";
import debug from "debug";
import { escapeHtml, renderMarkdown } from "./utilities.mts";
import { applyTemplating } from "./dom.mts";
const log = debug("server:queryLanguage");

// `p` is for "pipeline". Accepts functions and calls them with the previous result
export const p: (...args: unknown[]) => Promise<unknown> = async (...args) => {
    let lastValue = undefined;
    for (const a of args) {
        if (typeof a === "function") {
            lastValue = a(lastValue);
        } else {
            lastValue = a;
        }
        lastValue = await lastValue;
    }
    return lastValue;
};

export const siteProxy = ({
    baseDirectory,
}: {
    baseDirectory?: string | null;
}) =>
    new Proxy(
        {},
        {
            get(_target: unknown, prop: string) {
                if (!baseDirectory)
                    throw new Error(
                        "Can't access `site` without `baseDirectory` parameter",
                    );
                switch (prop) {
                    case "allFiles":
                        return listNonDirectoryFiles({
                            baseDirectory,
                        });
                    case "search":
                        return async (query: string) => {
                            const list = await listNonDirectoryFiles({
                                baseDirectory,
                            });
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
                                keys: [
                                    "contentPath",
                                    "originalContent",
                                    "meta.title",
                                ],
                            });
                            return fuse.search(query).map(({ item }) => item);
                        };
                }
            },
        },
    );

export const renderer =
    ({ topLevelParameters }: { topLevelParameters: ParameterValue }) =>
    async (contentPath: string, contentParameters?: ParameterValue) => {
        const baseDirectory = maybeStringParameterValue(
            topLevelParameters,
            "baseDirectory",
        );
        if (!baseDirectory) throw new Error("Required baseDirectory");

        const contentFileContents = await readFile({
            baseDirectory,
            contentPath,
        });

        log(
            `Applying in-query templating for ${contentPath} original query content query ${JSON.stringify(contentParameters)}`,
        );
        // TODO: I think "noApply" is more accurate than "raw", however can
        // probably come up with a better name. The point is "raw" implies too
        // much, or could mean several things, so I should pick some more narrow
        // concepts, even if they have to be mixed and matched
        if (contentParameters?.raw) {
            if (contentParameters.escape) {
                return escapeHtml(contentFileContents);
            }
            return contentFileContents;
        }
        if (contentParameters?.renderMarkdown) {
            // TODO if this set contents instead of returning that would seem to enable template values in markdown
            return renderMarkdown(contentFileContents);
        }
        return (
            await applyTemplating({
                content: contentFileContents,
                parameters: setEachParameterWithSource(
                    {},
                    contentParameters ?? {},
                    "query param",
                ),
                topLevelParameters,
            })
        ).content;
    };

export const or = (...args: unknown[]) => args.reduce((a, b) => a || b);
export const and = (...args: unknown[]) => args.reduce((a, b) => a && b);

export const pString: (
    pArgList: string,
    params?: {
        parameters: ParameterValue;
        topLevelParameters: ParameterValue;
    },
) => ReturnType<typeof p> = async (pArgList, params) => {
    const { parameters, topLevelParameters } = {
        parameters: params?.parameters ?? {},
        topLevelParameters: params?.topLevelParameters ?? {},
    };
    const site = siteProxy({
        baseDirectory: params
            ? maybeStringParameterValue(
                  params.topLevelParameters,
                  "baseDirectory",
              )
            : null,
    });
    const paramObject = {
        p,
        Temporal,
        parameters,
        topLevelParameters,
        site,
        render: renderer({
            topLevelParameters: params?.topLevelParameters ?? {},
        }),
        or,
        and,
        query: (input: string) => pString(input, params),
    } as const;
    const fn = new Function(
        "paramObject",
        [
            `const {`,
            // Fancyness so that we don't have to spell out each parameter
            // TODO: Might be a little simpler to use this Object.keys list
            // as the first N parameters to new Function instead
            // Though I guess then we're relying on the well-ordering of that?
            // Could use Object.entries, and then map once to keys and once to
            // values. But maybe this is simple enough then.
            Object.keys(paramObject).join(","),
            `} = paramObject;`,
            `return p(${pArgList});`,
        ].join("\n"),
    );

    Object.defineProperty(fn, "name", {
        value: "pString anonymous function",
    });
    return fn(paramObject);
};

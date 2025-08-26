import test from "node:test";
import assert from "node:assert";
import { setParameterWithSource, type ParameterValue } from "./engine.mts";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { parse } from "node-html-parser";
import { applyTemplating } from "./dom.mts";
import { html } from "./utilities.mts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const baseDirectory = `${__dirname}/../entries`;

async function applyTemplatingAndParse(
    parameters: ParameterValue,
    content: string,
) {
    const result = await applyTemplating({
        content,
        parameters,
        topLevelParameters: parameters,
    });
    const dom = parse(result.content);
    return {
        ...result,
        dom,
        $1: (selector: string) => dom.querySelector(selector)!,
        $: (selector: string) => dom.querySelectorAll(selector)!,
    };
}

test("Empty content does nothing", { concurrency: true }, async () => {
    const { content } = await applyTemplatingAndParse({}, "");
    assert.equal(content, "");
});

test(
    "Content without any dynamic elements does nothing",
    { concurrency: true },
    async () => {
        const input = html`
            <html lang="en-US">
                <head>
                    <meta charset="utf-8" />
                    <meta http-equiv="x-ua-compatible" content="ie=edge" />
                    <title>Hello World</title>
                    <meta name="description" content="Test page" />
                    <meta
                        name="viewport"
                        content="width=device-width, initial-scale=1"
                    />
                </head>
                <body>
                    <h1>This is a test page</h1>
                    <p>I repeat, this is only a test page</p>
                </body>
            </html>
        `;
        const { content } = await applyTemplatingAndParse({}, input);
        // They're the same minus whitespace changes caused from parsing
        // and re-stringifying
        assert.equal(content, parse(input).toString());
    },
);

test(
    "keep-if truthy replaces itself with its content",
    { concurrency: true },
    async () => {
        const input = html`
            <keep-if truthy="q/query/title"
                ><replace-with h1>Keep me!</replace-with></keep-if
            >
        `;
        const { $1 } = await applyTemplatingAndParse(
            setParameterWithSource({}, "title", "Test title", "query param"),
            input,
        );
        assert.equal(
            $1("h1").innerHTML,
            "Keep me!",
            "The contents remain and are processed",
        );
        assert.equal(
            $1("keep-if"),
            undefined,
            "The keep-if element removes itself",
        );
    },
);

test(
    "keep-if non-truthy drops itself with its content",
    { concurrency: true },
    async () => {
        const input = html`
            <keep-if truthy="q/query/title"><h1>Keep me!</h1></keep-if>
        `;
        const { $1 } = await applyTemplatingAndParse({}, input);
        assert.equal($1("h1"), undefined, "The content is removed");
        assert.equal(
            $1("keep-if"),
            undefined,
            "The keep-if element removes itself",
        );
    },
);

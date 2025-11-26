import test from "node:test"
import assert from "node:assert"
import {
  setEachParameterWithSource,
  setParameterWithSource,
  type ParameterValue,
} from "./engine.mts"
import { parse } from "node-html-parser"
import { applyTemplating } from "./dom.mts"
import { html } from "./utilities.mts"
import { buildEmptyCache } from "./fileCache.mts"

async function applyTemplatingAndParse(
  parameters: ParameterValue,
  content: string,
) {
  const result = await applyTemplating({
    fileCache: await buildEmptyCache(),
    content,
    parameters,
  })
  const dom = parse(result.content)
  return {
    ...result,
    dom,
    $1: (selector: string) => dom.querySelector(selector)!,
    $: (selector: string) => dom.querySelectorAll(selector)!,
  }
}

test("Empty content does nothing", { concurrency: true }, async () => {
  const { content } = await applyTemplatingAndParse({}, "")
  assert.equal(content, "")
})

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
          <meta name="viewport" content="width=device-width, initial-scale=1" />
        </head>
        <body>
          <h1>This is a test page</h1>
          <p>I repeat, this is only a test page</p>
        </body>
      </html>
    `
    const { content } = await applyTemplatingAndParse({}, input)
    // They're the same minus whitespace changes caused from parsing
    // and re-stringifying
    assert.equal(content, parse(input).toString())
  },
)

test("Links", { concurrency: true }, async () => {
  const input = html`
    <html lang="en-US">
      <head> </head>
      <body>
        <a href="test-href">Test link</a>
        <a href="test-href2">Test link 2</a>
      </body>
    </html>
  `
  const { links } = await applyTemplatingAndParse({}, input)
  assert.deepEqual(links, ["test-href", "test-href2"])
})

test(
  "keep-if truthy replaces itself with its content",
  { concurrency: true },
  async () => {
    const input = html`
      <keep-if truthy="parameters.title"><h1>Keep me!</h1></keep-if>
    `
    const { $1 } = await applyTemplatingAndParse(
      setParameterWithSource({}, "title", "Test title", "query param"),
      input,
    )
    assert.equal(
      $1("h1").innerHTML,
      "Keep me!",
      "The contents remain and are processed",
    )
    assert.equal($1("keep-if"), undefined, "The keep-if element removes itself")
  },
)

test(
  "keep-if non-truthy drops itself with its content",
  { concurrency: true },
  async () => {
    const input = html`
      <keep-if truthy="parameters.title"><h1>Keep me!</h1></keep-if>
    `
    const { $1 } = await applyTemplatingAndParse({}, input)
    assert.equal($1("h1"), undefined, "The content is removed")
    assert.equal($1("keep-if"), undefined, "The keep-if element removes itself")
  },
)

test(
  "Any element can have arbitrary executed attributes",
  { concurrency: true },
  async () => {
    const input = html`
      <a x-href="parameters.myHref">Test link</a>
      <span x-content="parameters.spanContent">Not here</span>
    `
    const { $1 } = await applyTemplatingAndParse(
      setEachParameterWithSource(
        {},
        { myHref: "Test href", spanContent: "new span stuff" },
        "query param",
      ),
      input,
    )
    assert.equal(
      $1("a").getAttribute("href"),
      "Test href",
      "Arbitrary executed attribute",
    )
    assert.match(
      $1("span").innerText,
      /new span stuff/,
      "Arbitrary executed attribute",
    )
  },
)

test(
  "<set-> sets multiple parameters for the rest of the document",
  { concurrency: true },
  async () => {
    const input = html` <set-
        foo="'foo value'"
        bar="'bar value overwrites'"
      ></set->
      <span x-content="parameters.foo">Replaced</span>
      <p x-class="parameters.bar">see attribute</p>`
    const { $1 } = await applyTemplatingAndParse(
      setEachParameterWithSource(
        {},
        { bar: "original value should be overwritten" },
        "query param",
      ),
      input,
    )
    assert.match($1("span").innerText, /foo value/)
    assert.match($1("p").getAttribute("class")!, /bar value overwrites/)
  },
)

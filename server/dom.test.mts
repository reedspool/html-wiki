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
    const { content } = await applyTemplatingAndParse(
      { nocontainer: true },
      input,
    )
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
    const input = html` <keep-if truthy="title"><h1>Keep me!</h1></keep-if> `
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
  "<render- if='truthy'> drops itself, keeps its content",
  { concurrency: true },
  async () => {
    const input = html`
      <render- if="parameters.title"><h1>Keep me!</h1></render->
    `
    const { $1 } = await applyTemplatingAndParse({ title: true }, input)
    assert.equal(
      $1("h1").innerHTML,
      "Keep me!",
      "The contents remain and are processed",
    )
    assert.equal($1("render-"), undefined, "The keep-if element removes itself")
  },
)
test(
  "<render- if='falsy'> drops itself with its content",
  { concurrency: true },
  async () => {
    const input = html`
      <render- if="parameters.title"><h1>Keep me!</h1></render->
    `
    const { $1 } = await applyTemplatingAndParse({ title: false }, input)
    assert.equal($1("h1"), undefined, "The content is removed")
    assert.equal($1("render-"), undefined, "The keep-if element removes itself")
  },
)
test(
  "<render- content='...'> drops itself and adds the query result",
  { concurrency: true },
  async () => {
    const input = html` <render- content="'abcd'"><h1>Keep me!</h1></render-> `
    const { content, $1 } = await applyTemplatingAndParse(
      { title: false },
      input,
    )
    assert.equal($1("h1"), undefined, "The content is removed")
    assert.match(content, /abcd/, "The query value appears")
  },
)

test(
  "<render- if='false' content='...'> drops itself and does not add the query result",
  { concurrency: true },
  async () => {
    const input = html`
      <render- if="title" content="'abcd'"><h1>Keep me!</h1></render->
    `
    const { content, $1 } = await applyTemplatingAndParse(
      { title: false },
      input,
    )
    assert.equal($1("h1"), undefined, "The content is removed")
    assert.doesNotMatch(content, /abcd/, "The query value appears")
  },
)
// TODO: This isn't so desirable, but it's how I implemented today
test.only(
  "<render- content='...' if='false'> DOES add the content because `content` comes before the `if` attribute",
  { concurrency: true },
  async () => {
    const input = html`
      <render- content="'abcd'" if="title"><h1>Keep me!</h1></render->
    `
    const { content, $1 } = await applyTemplatingAndParse(
      { title: false },
      input,
    )
    assert.equal($1("h1"), undefined, "The content is removed")
    assert.match(content, /abcd/, "The query value appears")
  },
)

test("<render- map='[...]'> works", { concurrency: true }, async () => {
  const input = html`
    <render- map="Array(9).fill(null).map((_,i) => i+1)"
      ><span x-content="currentListItem"
    /></render->
  `
  const { content, $ } = await applyTemplatingAndParse({ title: false }, input)
  const spans = $("span")
  assert.equal(spans.length, 9)
  for (let i = 0; i < spans.length; i++) {
    assert.match(spans[i].innerText, new RegExp(`${i + 1}`))
  }
})
test(
  "Any element can have arbitrary executed attributes",
  { concurrency: true },
  async () => {
    const input = html`
      <a x-href="myHref">Test link</a>
      <span x-content="spanContent">Not here</span>
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
      <span x-content="foo">Replaced</span>
      <p x-class="bar">see attribute</p>`
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

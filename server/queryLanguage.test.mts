import test from "node:test"
import assert from "node:assert"
import { buildMyServerPStringContext, p, pString } from "./queryLanguage.mts"
import { Temporal } from "temporal-polyfill"
import { wait } from "./utilities.mts"
import {
  setEachParameterWithSource,
  setParameterChildrenWithSource,
  setParameterWithSource,
} from "./engine.mts"
import { parse } from "node-html-parser"
import { configuredFiles } from "./configuration.mts"
import { buildCache } from "./fileCache.mts"

const o = { concurrency: true }
const fileCache = await buildCache({
  searchDirectories: [
    configuredFiles.testDirectory,
    configuredFiles.coreDirectory,
  ],
})
test("p() with no parameters returns undefined", o, async () => {
  assert.equal(await p(), undefined)
})

test(
  "p() with atomic value as first parameter returns that value",
  o,
  async () => {
    assert.equal(await p(5), 5)
    assert.equal(await p("5"), "5")
    assert.equal(await p(false), false)
    assert.equal(await p(null), null)
    assert.equal(await p(undefined), undefined)
    const anObject = {}
    assert.equal(await p(anObject), anObject)
  },
)

test("p() given a promise a promise", o, () => {
  const aPromise = new Promise(() => {})
  assert.ok(p(aPromise) instanceof Promise)
})

test("p() given a function, calls it and returns the result", o, async () => {
  let called = false
  const aFunction = () => ((called = true), 5)
  assert.equal(await p(aFunction), 5)
  assert.equal(called, true)
})

test(
  "p() given a value then a function, calls the function with the value and returns its result",
  o,
  async () => {
    let calledWith = undefined
    const aFunction = (a: unknown) => ((calledWith = a), 6)
    assert.equal(await p(5, aFunction), 6)
    assert.equal(calledWith, 5)
  },
)

test(
  "p() given 2 functions, calls the second function with the result of the first",
  o,
  async () => {
    let calledWith: unknown[] = []
    const aFunction = (a: unknown) => (calledWith.push(a), 33)
    const bFunction = (a: unknown) => (calledWith.push(a), 44)
    assert.equal(await p(22, aFunction, bFunction), 44)
    assert.deepEqual(calledWith, [22, 33])
  },
)

test(
  "p() given an async function calls it and awaits the result before passing it to the next",
  o,
  async () => {
    let calledWith: unknown[] = []
    const aFunction = async (a: unknown) => (calledWith.push(a), 33)
    const bFunction = (a: unknown) => (calledWith.push(a), 55)
    assert.equal(await p(11, aFunction, bFunction), 55)
    assert.deepEqual(calledWith, [11, 33])
  },
)

test(
  "pString() given a string, evals the contents of the string as if they were a parameter list to p()",
  o,
  async () => {
    const result = await pString("5,(a)=>a*3,(a)=>a+4", {})
    assert.equal(result, 19)
  },
)

test("pString() can get a current timestamp", o, async () => {
  const before = Temporal.Now.plainDateTimeISO()
  await wait(1)
  const result = await pString(
    "Temporal.Now.plainDateTimeISO().toString()",

    buildMyServerPStringContext({
      parameters: {},
      fileCache,
    }),
  )
  await wait(1)
  const after = Temporal.Now.plainDateTimeISO()
  if (typeof result !== "string") assert.fail()
  const then = Temporal.PlainDateTime.from(result)
  assert.equal(Temporal.PlainDateTime.compare(before, then), -1)
  assert.equal(Temporal.PlainDateTime.compare(after, then), 1)
})

test("pString() can access parameters", o, async () => {
  const parameters = setEachParameterWithSource(
    {},
    { title: "Hello World!" },
    "query param",
  )
  const result = await pString("parameters.title", {
    parameters,
  })
  assert.equal(result, "Hello World!")
})

test("pString() can get a non-string parameter as a string", o, async () => {
  const parameters = setEachParameterWithSource(
    {},
    { someNumber: 51234 },
    "query param",
  )
  const result = await pString("parameters.someNumber", {
    parameters,
  })
  assert.equal(result, "51234")
})

test("pString() can get a deeper parameter", o, async () => {
  const parameters = setParameterChildrenWithSource(
    {},
    "levelOne",
    setParameterChildrenWithSource(
      {},
      "levelTwo",
      setParameterWithSource({}, "levelThree", "level four", "query param"),
      "query param",
    ),
    "query param",
  )
  const result = await pString("parameters.levelOne.levelTwo.levelThree", {
    parameters,
  })
  assert.equal(result, "level four")
})

test(
  "pString() with a non-existent parameter returns undefined",
  o,
  async () => {
    const parameters = setEachParameterWithSource(
      {},
      { someNumber: 51234 },
      "query param",
    )
    const result = await pString("parameters.nonExistant", {
      parameters,
    })
    assert.equal(result, undefined)
  },
)

test(
  "pString() given a string template with funky characters returns the string",
  o,
  async () => {
    const result = await pString("`this works ${invalidJSString}`", {
      invalidJSString: "abcd-efgh",
    })
    assert.equal(result, "this works abcd-efgh")
  },
)

test("site.allFiles gets all the files", o, async () => {
  const parameters = setEachParameterWithSource(
    {},
    {
      userDirectory: configuredFiles.testDirectory,
      coreDirectory: configuredFiles.coreDirectory,
    },
    "query param",
  )
  const result = await pString(
    "site.allFiles",
    buildMyServerPStringContext({
      parameters,
      fileCache,
    }),
  )
  assert.ok(Array.isArray(result))
  assert.ok(result.length > 3)
  const index = result.find((file) => file.contentPath === "/index.html")
  assert.ok(index)
  assert.equal(index.name, "index.html")
  assert.equal(index.contentPath, configuredFiles.rootIndexHtml)
  assert.equal(index.meta.title, "HTML Wiki Homepage")
  const edit = result.find((file) => file.contentPath.includes("/edit.html"))
  assert.ok(edit)
  assert.equal(edit.name, "edit.html")
  assert.equal(edit.contentPath, configuredFiles.defaultEditTemplateFile)
  assert.equal(edit.meta.title, "Edit Page")
})

test("site.search(<exact title>) gets that page", o, async () => {
  const parameters = setEachParameterWithSource(
    {},
    {
      userDirectory: configuredFiles.testDirectory,
      coreDirectory: configuredFiles.coreDirectory,
    },
    "query param",
  )
  const result = await pString(
    "site.search('HTML Wiki')",
    buildMyServerPStringContext({
      parameters,
      fileCache,
    }),
  )
  assert.ok(Array.isArray(result))
  assert.ok(result.length > 0)
  const index = result.find((file) => file.contentPath === "/index.html")
  assert.ok(index)
  assert.equal(index.name, "index.html")
  assert.equal(index.contentPath, "/index.html")
  assert.equal(index.meta.title, "HTML Wiki Homepage")
  const edit = result.find((file) => file.contentPath.includes("/edit.html"))
  assert.ok(!edit)
})

test("site.search(<fuzzy>) gets that page", o, async () => {
  const parameters = setEachParameterWithSource(
    {},
    {
      userDirectory: configuredFiles.testDirectory,
      coreDirectory: configuredFiles.coreDirectory,
    },
    "query param",
  )
  const result = await pString(
    "site.search('ht wi')",
    buildMyServerPStringContext({
      parameters,
      fileCache,
    }),
  )
  assert.ok(Array.isArray(result))
  assert.ok(result.length > 0)
  const index = result.find((file) => file.contentPath === "/index.html")
  assert.ok(index)
  assert.equal(index.name, "index.html")
  assert.equal(index.contentPath, "/index.html")
  assert.equal(index.meta.title, "HTML Wiki Homepage")
  const edit = result.find((file) => file.contentPath.includes("/edit.html"))
  assert.ok(!edit)
})

test("site.search(<anything>) searches body of pages", o, async () => {
  const parameters = setEachParameterWithSource(
    {},
    {
      userDirectory: configuredFiles.testDirectory,
      coreDirectory: configuredFiles.coreDirectory,
    },
    "query param",
  )
  const result = await pString(
    "site.search('home page')",
    buildMyServerPStringContext({
      parameters,
      fileCache,
    }),
  )
  assert.ok(Array.isArray(result))
  assert.ok(result.length > 0)
  const index = result.find((file) => file.contentPath === "/index.html")
  assert.equal(index.contentPath, "/index.html")
  const edit = result.find((file) => file.contentPath.includes("/edit.html"))
  // TODO: I'm not sure why this comes in there, but it does
  // Honestly, this Fuse fuzzy search is way overboard for what I wanted.
  // I really want fuzzy only for space-separated tokens not for every character
  assert.ok(edit)
})

test("site.search(<anything>) gets titles of Markdown pages", o, async () => {
  const parameters = setEachParameterWithSource(
    {},
    {
      userDirectory: configuredFiles.testDirectory,
      coreDirectory: configuredFiles.coreDirectory,
    },
    "query param",
  )
  const result = await pString(
    "site.search('Markdown File Title')",
    buildMyServerPStringContext({
      parameters,
      fileCache,
    }),
  )
  assert.ok(Array.isArray(result))
  assert.ok(result.length > 0)
  const testMarkdownFile = result.find(
    (file) => file.contentPath === configuredFiles.testMarkdownFile,
  )
  assert.ok(testMarkdownFile)
  assert.equal(testMarkdownFile.name, "test.md")
  assert.equal(testMarkdownFile.contentPath, configuredFiles.testMarkdownFile)
  // assert.equal(testMarkdownFile.meta.title, "Markdown File Title");
  const index = result.find((file) => file.contentPath === "/index.html")
  assert.ok(!index)
  const edit = result.find((file) => file.contentPath.includes("/edit.html"))
  assert.ok(!edit)
})

test("site.search(<anything>) gets contents of Markdown pages", o, async () => {
  const parameters = setEachParameterWithSource(
    {},
    {
      userDirectory: configuredFiles.testDirectory,
      coreDirectory: configuredFiles.coreDirectory,
    },
    "query param",
  )
  const result = await pString(
    "site.search('simple markdown file')",
    buildMyServerPStringContext({
      parameters,
      fileCache,
    }),
  )
  assert.ok(Array.isArray(result))
  assert.ok(result.length > 0)
  const testMarkdownFile = result.find(
    (file) => file.contentPath === configuredFiles.testMarkdownFile,
  )
  assert.ok(testMarkdownFile)
  assert.equal(testMarkdownFile.name, "test.md")
  assert.equal(testMarkdownFile.contentPath, configuredFiles.testMarkdownFile)
  // assert.equal(testMarkdownFile.meta.title, "Markdown File Title");
  const index = result.find(
    (file) => file.contentPath === configuredFiles.rootIndexHtml,
  )
  assert.ok(!index)
  const edit = result.find((file) =>
    file.contentPath.includes(configuredFiles.defaultEditTemplateFile),
  )
  assert.ok(!edit)
})

test("render(parameters.contentPath) renders a page", o, async () => {
  const parameters = setEachParameterWithSource(
    {},
    {
      userDirectory: configuredFiles.testDirectory,
      coreDirectory: configuredFiles.coreDirectory,
      contentPath: configuredFiles.rootIndexHtml,
    },
    "query param",
  )
  const result = await pString(
    "render(parameters.contentPath)",
    buildMyServerPStringContext({
      parameters,
      fileCache,
    }),
  )

  assert.ok(typeof result == "string")
  const dom = parse(result)
  const $1 = (selector: string) => dom.querySelector(selector)

  // Homepage content
  assert.match($1("h1")!.innerHTML, /HTML Wiki/)
  // Some of the global page wrapper
  // TODO: Waiting on this for when `index.html` declares its own page wrapper
  assert.doesNotMatch(
    $1('header nav ul a[href="/"]')?.innerHTML ?? "no match",
    /Home/,
  )
})

import test from "node:test";
import assert from "node:assert";
import { p, pString } from "./queryLanguage.mts";
import { Temporal } from "temporal-polyfill";
import { wait } from "./utilities.mts";
import {
    setEachParameterWithSource,
    setParameterChildrenWithSource,
    setParameterWithSource,
} from "./engine.mts";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { parse } from "node-html-parser";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const baseDirectory = `${__dirname}/../entries`;

const o = { concurrency: true };
test("p() with no parameters returns undefined", o, async () => {
    assert.equal(await p(), undefined);
});

test(
    "p() with atomic value as first parameter returns that value",
    o,
    async () => {
        assert.equal(await p(5), 5);
        assert.equal(await p("5"), "5");
        assert.equal(await p(false), false);
        assert.equal(await p(null), null);
        assert.equal(await p(undefined), undefined);
        const anObject = {};
        assert.equal(await p(anObject), anObject);
    },
);

test("p() given a promise a promise", o, () => {
    const aPromise = new Promise(() => {});
    assert.ok(p(aPromise) instanceof Promise);
});

test("p() given a function, calls it and returns the result", o, async () => {
    let called = false;
    const aFunction = () => ((called = true), 5);
    assert.equal(await p(aFunction), 5);
    assert.equal(called, true);
});

test(
    "p() given a value then a function, calls the function with the value and returns its result",
    o,
    async () => {
        let calledWith = undefined;
        const aFunction = (a: unknown) => ((calledWith = a), 6);
        assert.equal(await p(5, aFunction), 6);
        assert.equal(calledWith, 5);
    },
);

test(
    "p() given 2 functions, calls the second function with the result of the first",
    o,
    async () => {
        let calledWith: unknown[] = [];
        const aFunction = (a: unknown) => (calledWith.push(a), 33);
        const bFunction = (a: unknown) => (calledWith.push(a), 44);
        assert.equal(await p(22, aFunction, bFunction), 44);
        assert.deepEqual(calledWith, [22, 33]);
    },
);

test(
    "p() given an async function calls it and awaits the result before passing it to the next",
    o,
    async () => {
        let calledWith: unknown[] = [];
        const aFunction = async (a: unknown) => (calledWith.push(a), 33);
        const bFunction = (a: unknown) => (calledWith.push(a), 55);
        assert.equal(await p(11, aFunction, bFunction), 55);
        assert.deepEqual(calledWith, [11, 33]);
    },
);

test(
    "pString() given a string, evals the contents of the string as if they were a parameter list to p()",
    o,
    async () => {
        const result = await pString("5,(a)=>a*3,(a)=>a+4");
        assert.equal(result, 19);
    },
);

test("pString() can get a current timestamp", o, async () => {
    const before = Temporal.Now.plainDateTimeISO();
    await wait(1);
    const result = await pString("Temporal.Now.plainDateTimeISO().toString()");
    await wait(1);
    const after = Temporal.Now.plainDateTimeISO();
    if (typeof result !== "string") assert.fail();
    const then = Temporal.PlainDateTime.from(result);
    assert.equal(Temporal.PlainDateTime.compare(before, then), -1);
    assert.equal(Temporal.PlainDateTime.compare(after, then), 1);
});

test("pString() can access parameters", o, async () => {
    const topLevelParameters = setEachParameterWithSource(
        {},
        { title: "Hello World!" },
        "query param",
    );
    const result = await pString("parameters.title", {
        parameters: topLevelParameters,
        topLevelParameters,
    });
    assert.equal(result, "Hello World!");
});

test("pString() can get a non-string parameter as a string", o, async () => {
    const topLevelParameters = setEachParameterWithSource(
        {},
        { someNumber: 51234 },
        "query param",
    );
    const result = await pString("parameters.someNumber", {
        parameters: topLevelParameters,
        topLevelParameters,
    });
    assert.equal(result, "51234");
});

test("pString() can get a deeper parameter", o, async () => {
    const topLevelParameters = setParameterChildrenWithSource(
        {},
        "levelOne",
        setParameterChildrenWithSource(
            {},
            "levelTwo",
            setParameterWithSource(
                {},
                "levelThree",
                "level four",
                "query param",
            ),
            "query param",
        ),
        "query param",
    );
    const result = await pString("parameters.levelOne.levelTwo.levelThree", {
        parameters: topLevelParameters,
        topLevelParameters,
    });
    assert.equal(result, "level four");
});

test(
    "pString() with a non-existent parameter returns empty string",
    o,
    async () => {
        const topLevelParameters = setEachParameterWithSource(
            {},
            { someNumber: 51234 },
            "query param",
        );
        const result = await pString("parameters.nonExistant", {
            parameters: topLevelParameters,
            topLevelParameters,
        });
        assert.equal(result, "");
    },
);

test("site.allFiles gets all the files", o, async () => {
    const topLevelParameters = setEachParameterWithSource(
        {},
        { baseDirectory },
        "query param",
    );
    const result = await pString("site.allFiles", {
        parameters: topLevelParameters,
        topLevelParameters,
    });
    assert.ok(Array.isArray(result));
    assert.ok(result.length > 3);
    assert.ok(result.find((file) => file.contentPath === "/index.html"));
});

test("site.allFiles with no base directory is an error", o, async () => {
    const topLevelParameters = setEachParameterWithSource(
        {},
        { baseDirectory: null },
        "query param",
    );
    assert.rejects(() =>
        pString("site.allFiles", {
            parameters: topLevelParameters,
            topLevelParameters,
        }),
    );
});

test("render(parameters.contentPath) renders a page", o, async () => {
    const topLevelParameters = setEachParameterWithSource(
        {},
        { baseDirectory, contentPath: "/index.html" },
        "query param",
    );
    const result = await pString("render(parameters.contentPath)", {
        parameters: topLevelParameters,
        topLevelParameters,
    });

    assert.ok(typeof result == "string");
    const dom = parse(result);
    const $1 = (selector: string) => dom.querySelector(selector);

    // Homepage content
    assert.match($1("h1")!.innerHTML, /HTML Wiki/);
    // Some of the global page wrapper
    // TODO: Waiting on this for when `index.html` declares its own page wrapper
    assert.doesNotMatch(
        $1('header nav ul a[href="/"]')?.innerHTML ?? "no match",
        /Home/,
    );
});

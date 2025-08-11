# About this project

## Logbook

### Sun Aug 10 09:56:20 AM PDT 2025

Future: I thought in my query language that I'd want to control whether or not the result would be HTML escaped. Maybe also URI encoded?

I removed the features which allowed a markdown file to rest in the content of an HTML file. It added a lot of complication to both rendering and saving files. I thought maybe in the future I'd end up with tools to achieve this, but for now it didn't seem worth it to continue supporting. Instead, I put my markdown content in their own `.md` files.

I had peppered in so much direct references and assumptions to files ending with `.html` that implementing special rendering for `.md` files was intimidating. If I requested path `project/logbook` with no file extension my server assumed I meant to append `.html` to it, and did so for itself so it could access the real file on disk. Should this "automatic file extension" feature not exist? Or should it only work for `.html` files? The latter seemed like the simplest root right now. Maybe I'd consider other options in the future.

Future: All around I had peppered `/${filename}` because some places I was storing filenames with no leading slash and other places I was storing it with a leading slash. I wanted to unify on one expectation, leading slash or no. I felt I was going to head towards yes, always including the leading slash. I couldn't think of anywhere in the codebase I was removing the leading slash, only adding it. From the URL spec, it looked like I was talking about ["path absolute URL strings"](https://url.spec.whatwg.org/#path-absolute-url-string) as opposed to ["path relative URL strings"](https://url.spec.whatwg.org/#path-relative-url-string), which maybe I'd find use for later. For now, I was always referring to a full path from some root so absolute made sense. I refactored everything around this. I considered using TypeScript's string template types to help, but I worried that might be too finicky for any possible gain.

Future: I thought about how the bulk of the work was building an engine which comprised both the templating engine and the query language together. And this engine was a distinct component from the server. It so happened that the engine did a lot of things we consider a server to do. But the server part which dealt with HTTP requests was distinct. When the server received an HTTP request, it used all the information in that request to configure a call to this engine, and then it handled the response of that engine to the HTTP response most of the time. But the engine was a well-delineated compoonent, so I thought it was a good idea to extract and separate that from the server. I imagined other uses for the engine as well, for example:

Future: I made a CLI command to generate a static site out of all the dynamic pages. This process used the same engine as the HTTP server, but it didn't need to start the server and make an HTTP request, it just called that engine directly. It essentially scanned the whole directory structure of the "entries" directory, and for each page, sent a command to the engine to do what it would do if it got a request to view that page, including applying any templating, and then write out the results into a similar directory structure which could be packaged or served statically.

### Sat Aug  9 09:57:24 PM PDT 2025

Future: As I kept working I realized I wanted more string templating capabilities in my budding query language. At this stage, my "language" was really just a dispatch for some specific code, there wasn't any of the combination or imperative powers suggested by the title "programming language". But I found a clear use case for string manipulation: I wanted to append `?raw` to another query which I'd already written to determine an entry file name. It felt good to wait for specific usecases while working on the core of the server before trying to make a complicated programming language, so I continued to hold off on adding the feature for now.

### Sat Aug  9 02:26:34 PM PDT 2025

Implemented the tree walking strategy and it worked well. That started to make the whole theory sensible. The server had two core features. First it was an entry point to the templating engine. Second, it implemented the query langauge. Then, the templating engine could call on the query language during expansion. This made the templating engine and query language mutually recursive. The concept felt clear and powerful, but I felt I had a lot more work to do in order to realize the potential.

The request for a basic page became a configuration and expansion. For example, in order to implement a global template, so I wouldn't have to repeat a header and footer in every HTML page, I made a `global-page.html`. This contained a custom element template HTML tag: `<replace-with main x-content="q/query/content">` This instructed the templating engine to replace this element with a `main` tag, with the contents of the result of the query in the value of the attribute, in this case `q/query/content`. 

This part might be confusing since "query" means two separate things here. First, this whole string `q/query/content` is the input to my "query language". It's not a complex language, though the slashes might suggest as such, it's more the suggestion of becoming a complex language in the future. For now, though, that whole string literally just maps to one bit of functionality. That functionality derives the content from the URL query, aka search parameters, aka everything between `?` and `#`. So I have my query language getting content from the URL query.

The value in the URL query parameter named `content` needed to be a path, exactly like you would use to get a file. In fact, you could replace your whole path with the path in the `content` query parameter to see what that content would be. The query language was responsible for applying the templating engine to the file at that content path.

If this seems confusing, then yes, you're on the right track. Mutual recursion can be messy!

I struggled with how to package further query strings into the `content` URL parameter, to parameterize how the template engine expanded that `content` page without interfering with how it expanded the top level page. For example, if my URL turned out to be `/some-page?content=another-page?edit&raw`, should the query engine interpret `&raw` as a query parameter for `some-page?` or `another-page?`. The answer, I thought, was to URI encode each path definition. And I'd end up URI encoding.

This felt dangerous. Could one nest URI encodings without losing any information? I thought I saw a warning recently about that. I wrote a little function to test encoding and decoding components: 

```js
function encodeAndDecode(str, depth = 2) {
  console.log(`${depth}: ${str}`);
  if (depth === 0) return str;
  const encoded = encodeAndDecode(encodeURIComponent(str), depth - 1);
  const decoded = decodeURIComponent(encoded);
  console.log(`${depth}: ${} [decoded]`);
  return decodeURIComponent(encoded);
}
```

Then I called it like this with a bunch of special characters:

```js
let a="?%3 quick+brown++fox 333^&*(/\\"; 
encodeAndDecode(a, 5) === a
```

And got these results:

```text
5: ?%3 quick+brown++fox 333^&*(/\
4: %3F%253%20quick%2Bbrown%2B%2Bfox%20333%5E%26*(%2F%5C
3: %253F%25253%2520quick%252Bbrown%252B%252Bfox%2520333%255E%2526*(%252F%255C
2: %25253F%2525253%252520quick%25252Bbrown%25252B%25252Bfox%252520333%25255E%252526*(%25252F%25255C
1: %2525253F%252525253%25252520quick%2525252Bbrown%2525252B%2525252Bfox%25252520333%2525255E%25252526*(%2525252F%2525255C
0: %252525253F%25252525253%2525252520quick%252525252Bbrown%252525252B%252525252Bfox%2525252520333%252525255E%2525252526*(%252525252F%252525255C
1: %2525253F%252525253%25252520quick%2525252Bbrown%2525252B%2525252Bfox%25252520333%2525255E%25252526*(%2525252F%2525255C [decoded]
2: %25253F%2525253%252520quick%25252Bbrown%25252B%25252Bfox%252520333%25255E%252526*(%25252F%25255C [decoded]
3: %253F%25253%2520quick%252Bbrown%252B%252Bfox%2520333%255E%2526*(%252F%255C [decoded]
4: %3F%253%20quick%2Bbrown%2B%2Bfox%20333%5E%26*(%2F%5C [decoded]
5: ?%3 quick+brown++fox 333^&*(/\ [decoded]
> true
```

That `true` at the end reassured me. It meant that the encoded and decoded strings were exactly the same. So I moved forward with this plan.

Future: Immediately I saw these encoded values become noisy. Limits and reductions to that noise became a constraint and goal for the query language. Especially my abundant use of `/`. Maybe in the short term I could switch that character to something unencoded, like `.`. Every single character encoded became three characters!

### Wed Aug  6 04:57:31 PM PDT 2025

Implementing the create page made a funny bug. At first I just copied and pasted the edit page, with the same form. And it seemed to work! Except... it edited the current page, just like the edit form, which meant it wasn't creating a new page, it was overwriting the Create page. Almost lost all my work on creating that page. Facepalm. Luckily my text editor's undo worked on the changes made elsewhere. Whew.

I knew I wanted to use a tree-walking strategy to implement the HTML-as-template, replacing and updating elements from the root of the document down, replacing outer elements before inner elements (most of the time?). But the API to query all of a given kind of element and change just those was so straightforward that I kept that in for the time being while I played around. It wouldn't be hard to make the tree walker, I hoped, but it wasn't what I found most compelling at the moment.

After fixing creation, I quickly implemented deletion. With that, I had all the tools to write a complete integration test which created, retrieved, edited, and deleted a temporary page.

Future: I wrote more integration tests to cover more configurations with various uses of "raw" and file types.

### Mon Aug  4 06:44:02 PM PDT 2025

I began work on the `create` template and functionality. An idea I cribbed from TiddlyWiki was to name a new file with a timestamp. That led me to want a syntax for inserting a value into an `input` tag's `value` attribute. My only templating concept so far was to use `slot` tags. Was there another HTML-first or otherwise-web-first method for targeting a certain attribute? I thought about making a surrounding `slot` tag with attributes pointing to the element, attribute, and value which should be set within it. I also thought of some special global attributes, like `x-set`. I wanted to avoid non-standard syntax for the attribute values themselves, like how many templating languages use curly braces to signify calculated attributes, e.g. `<input value={inputValue} />`. That syntax makes sense if you already take it as a given that you're not writing HTML, but something which resolves to HTML. I wanted to write HTML.

I realized there was a whole part of the spec I hadn't used yet, custom elements. What if I made a templating DSL which used specific custom elements? The names and attributes together would be more than enough expressiveness, I thought. For example, how about if I declared what element to replace the custom element with, and how? E.g.

```html
<replace-with input value="{value}" />
```

And the way I had used `slot` elements up to this point could also be replaced with semantically named custom elements, like:

```html
<remove-if true="{value}">...</remove-if>
<keep-if true="{value}">...</keep-if>
```

Those values could also be queries.

[TiddlyWiki][tiddlywiki]'s expressive filter language enabled many emergent usecases, but ever since I began using TW, I always resisted learning it. I read the [history of the syntax][tiddlywiki-filter-syntax-history] page (which coincidentally had only been added a few days prior?) which confirmed a suspicion: the features had acreted over time after its inception as a clever riff on the classic wiki link syntax. I wanted to reflect on the total goals of the query language, the successes and failures of other languages including TW's, and ensure queries were a first class citizen with a thoughtful structure.

I wanted my query language to sensibly fit into a URL path as well as it fit into attributes in the templating language. That felt like a powerful hypermedia-focused constraint. That would empower users to use the same language whether they were adding client-side features or server-side.

I considered whether this should effect my prior decision to use the top-level of the path to direct to pages/entries. Maybe pages should have their own top-level path, e.g. `https://my.wiki/p/About.html`, and queries could have their own too, e.g. `https://my.wiki/q/pages titled like About`. In fact, maybe `p/About` was its own query? It's querying for a page! In that case, the top level path would be a query.

### Sun Aug  3 10:51:08 AM PDT 2025

Up to this point, I only had "raw" HTML pages, but I wanted to support Markdown. I thought I could identify what content the HTML page stored via a [`<meta>` tag][mdn-meta-tag] in the `<head>`. That led me to the [`itemprop` attribute][mdn-itemprop-attribute] which seemed perfect for the job. So I'd differentiate Markdown content from "just a normal HTML page" with a tag like `<meta itemprop="content-type" content="markdown">`.

What did it mean for the Markdown content to exist within HTML? I thought of two clear possibilities.

My first idea was that the only contents of the `<body>` tag would be plain Markdown text. Unfortunately, I knew that if someone ever opened this HTML page in a browser with no additional CSS, the page would look bad as all the whitespace would be messed up. I could solve that with a small touch of CSS, though.

My second idea was that the Markdown would be within a `<code><pre>` combination which was the standard for presenting plaintext in a webpage because browsers formatted such text how you would expect to see it in your text editor, with preserved whitespace and a monospace font, without any custom CSS. The downside of this approach was that there would still be "HTML content" in the file which in my head was ideally only "markdown content".

So it seemed like I was either going to end up adding some extra CSS or some extra HTML to my "raw markdown in HTML" file. So be it. Maybe I could try both and see which I liked more?

I searched for a way to embed content in HTML which would escape any internal HTML without an external process. I couldn't think of one off the top of my head, but hopefully that was a blind spot which I could fill in, not a signal that the concept was misguided. Later I realized that a `script` tag would be appropriate with CSS to display its contents.

I created a markdown file (in HTML) to test with (probably this one you're looking at!). I started to write it in a ["logbook" format][reeds-website-logbooks] I enjoy. I backdated some content in the logbook to explain the project's origins.

I named the file with a file extension `.html`, because it was an HTML file. I realized that my text editor didn't love this. It attempted to format the page as HTML over and over and failed to do so, because I'd written so many HTML tags in Markdown code snippets. Sorry formatter :( Still, I overcame this pretty easily by telling my text editor that, despite the file extension, this was indeed a Markdown file. Then it didn't try to format anything at all. Whew.

I tried the version with the `<code><pre>` first, and I found an interesting unintended side effect. When I tried to view the page "raw", The text was formatted okay, though there was no line wrap so long paragraphs created a horizontal scroll, which meant even with this method I'd be adding some CSS to make it pretty. Far weirder was that all the code blocks which I'd written which contained HTML tags, such as `<button>`, the browser did its best to try to make sense of as HTML. No process was escaping those as I had imagined. I don't know why I imagined that, I just didn't think that far ahead. This was a fun surprise! The page felt properly fun and weird with all the random HTML elements strewn all over and the formatting messed up. But it probably wasn't a very useful view.

Next, I made my server recognize the `meta` tag and render the Markdown into HTML when displayed.

I added a query parameter option via `?raw` to skip this rendering step and see the original HTML page.

Then I made the `?edit` page also only put the Markdown textual content within the editable area. Of course, I also had to make the save functionality also only replace the markdown content.

And finally the other side where `?edit&raw` brings you back to the normal, full HTML page edit experience even if you have a different content-type.

### Sat Aug  2 10:28:03 AM PDT 2025

At [HTML Day 2025][html-day-2025] in [Portland][html-day-2025-pdx], I got the "edit" page to actually work and submit edits! It was really fun to edit the pages.

I also made the edit page a normal entry, which is a trick I learned from [TiddlyWiki][tiddlywiki]. So the edit page itself existed at `/$/templates/edit`. And you could edit that page as easily as any other by adding `?edit` to edit itself! Trippy.

Someone at HTML Day pointed out that you could easily break the whole site by removing the `<slot>` and `button` from the edit page, thus disallowing any further edits to any page. Fun!

### Fri Aug  1  7:00:14 PM PDT 2025

This idea came to me as I used and enjoyed [TiddlyWiki][tiddlywiki] (TW) more and more. I always used TW the [Node Web Server mode of TW][tiddlywiki-node] mode because it simplified the persistence model for me; I wanted the files on my harddrive, to edit them in my text editor sometimes, to sync them across my devices with [Syncthing][syncthing], and I also wanted to back them up in GitHub (note using Syncthing and `git` together isn't recommended).

As I used this combination, I yearned for a more "web-first" version. TW is web-first in the sense that its origins are as a single page application using only HTML, CSS, and JS's powers combined to create a wiki. But that origin story doesn't include external persistence. Instead, amazingly, TW's original model is to use no server whatsoever and still achieve persistence! It did so (and still does so!) via the browser's "download" functionality. Other [varied external persistence](tiddlywiki-saving) models have since been added on to widen TW's use cases.

The "web-first" that I'm more interested in is one which is more inclusive of how the web works in total, not just how a webpage works once its inside the browser. I want to see what a wiki would look like with a strong foundation in hypermedia (see [Hypermedia as the Engine of Application State (HATEOAS)][hateoas]).

I searched around the internet and I couldn't find an existing strong example of what I was thinking of, which surprised me. Every wiki, CMS, static site generator, dynamic blog, etc, which I could find or think of used one of two models, a database or "raw" content files. In the former, content existed solely in a database until requested, at which point the server extracted it and transformed it into a presentable HTML page. The latter model was much the same, except that files existed on disk, identified by file extension (`.md`) and [front matter][jekyll-front-matter].

I decided to just try building my idea. My first thought was, "what if every page in this wiki were an entire HTML file?" Everything else fell out from there. At the base level, I'd need a web server to transmit those files to the browser and receive updates.

I started by copying and pasting a previous NodeJS & Express web-server from a previous project. At first, it was just a simple web server which would present local files.

Then I made an "edit" page which did the first interesting thing. When I presented the edit page, I would replace the `<slot name="content">` element with the content of the file of the page I wanted to edit. I put that `slot` inside a `<textarea>` and voila, I could edit the text!

At first I thought it would be cool if you could add "commands" onto the end of the path, e.g. to use the edit command on `/posts/my-first-post.html`, you'd append `/edit` to make it `/posts/my-first-post.html/edit`. But I soon saw a conflict if someone named a file the same as those commands, e.g. `about/commands/edit`. Should that take you to a page called "About the Edit Command,", or the edit page for "About Commands"? What's wrong with either convention other than the arbitrary rule I'd made up? So I moved those commands into query parameters instead, which made the first example work like `/posts/my-first-post.html?edit` instead. I was super glad I had automated tests for all my expecations when I decided to make this change.

Although I had an "edit page", it didn't yet have a button to actually submit your edits, so it didn't achieve its name yet.

I was excited, and I wanted to work all night on it, but I made myself go to bed at a reasonable hour to have the energy for [HTML Day][html-day-2025] the next day.

[tiddlywiki]: http://tiddlywiki.com/ "TiddlyWiki homepage"
[tiddlywiki-node]: https://tiddlywiki.com/static/WebServer.html "TiddlyWiki's Node WebServer"
[syncthing]: https://github.com/syncthing/syncthing "Syncthing"
[tiddlywiki-saving]: https://tiddlywiki.com/#Saving "TiddlyWiki saving"
[hateoas]: https://htmx.org/essays/hateoas/ "HATEOAS by Carson Gross, creator of htmx"
[html-day-2025]: https://html.energy/html-day/2025/index.html "HTML Day 2025"
[html-day-2025-pdx]: https://the-sudo.net/pages/events/html-day "HTML Day 2025 in Portland, OR"
[jekyll-front-matter]: https://jekyllrb.com/docs/front-matter/ "Jekyll's Front Matter"
[mdn-meta-tag]: https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/meta "MDN, <meta> tag"
[mdn-itemprop-attribute]: https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Global_attributes/itemprop "MDN, itemprop attribute"
[reeds-website-logbooks]: https://reeds.website/topic-project-logs "Reed's Website, Logbooks"
[tiddlywiki-filter-syntax-history]: https://tiddlywiki.com/#Filter%20Syntax%20History "TiddlyWiki Filter Syntax History"


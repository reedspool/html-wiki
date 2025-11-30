# Markdown Fixture File Title

A simple markdown file to test whether stuff works.

Here's an external link to [Google](https://www.google.com).

## Second heading

Here's **bold** and _emphasized_ formatted text

Here's a [reference link][index].

Here's a [/shortcut reference link with no associated reference link definition]. I use a trick to generate reference link definitions for these on the fly.

Here's a [link with a malformed space in the URL](oops can't have a space here), to show that my shortcut reference link trick doesn't apply to the normal Markdown link syntax.

And some `inline code` as well as a codeblock:

```js
// Comment
const log = () => console.log("log!");
```

<p class="static-html">Here's some <em>static</em> HTML content</p>

Now here's some HTML content within inline code `<code><pre>`.

- [ ] Here's a list item with a checkbox

<drop-if truthy="dropit !== undefined">
  <p class="dropped">This would be dropped if templating is applied AND the dropit query is supplied</p>
</drop-if>

<keep-if truthy="dropit !== undefined">
  <p class="kept">This would be kept when templating is applied AND the dropit query is supplied</p>
</keep-if>

[index]: /index "Reference link to index"

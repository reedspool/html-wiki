// TODO: Could I check an attribute on the exact script tag which loaded this
// to see whether to load it for the whole page or not?
const wait = (millis) => new Promise((resolve) => setTimeout(resolve, millis))
// TODO: I don't know that this is the right event to listen to, or maybe also need to check the status before?
document.addEventListener("DOMContentLoaded", () => {
  console.log("DOMContentLoaded")
  document.body.addEventListener("click", async ({ target }) => {
    const button = target.closest("button")
    if (!button) return
    const isCopyButton = button.hasAttribute("copy")
    const isInsertButton = button.hasAttribute("insert")
    if (isCopyButton && isInsertButton)
      throw new Error(
        "Buttons should have only one of copy or insert attributes",
      )
    if (!isCopyButton && !isInsertButton) return
    let text = button.getAttribute(isCopyButton ? "copy" : "insert")
    if (!text) {
      text = target
        .closest("[copy-target-container]")
        .querySelector("[copy-target]").innerText
    }
    if (!text) {
      console.error(
        `Expected either a value for ${isCopyButton ? "copy" : "insert"} or a copy-target within a copy-target-container`,
      )
      button.innerHTML = "Error :-/"
    }
    try {
      button.setAttribute("disabled", "true")
      if (isCopyButton) {
        await navigator.clipboard.writeText(text)
      } else {
        // Send message to parent frame
        var event = new CustomEvent("insertText", { detail: { text } })
        if (!window.parent)
          throw new Error("Can't insert without access to parent document ")
        window.parent.document.dispatchEvent(event)
      }
      const originalText = button.innerHTML
      button.innerHTML = isCopyButton ? "Copied!" : "Inserted!"
      await wait(1750)
      button.innerHTML = originalText
      button.removeAttribute("disabled")
    } catch (error) {
      console.error("Error copying", error)
      button.innerHTML = "Error :-/"
    }
  })
})

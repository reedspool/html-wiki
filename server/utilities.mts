// Stolen from NakedJSX https://github.com/NakedJSX/core
export const escapeHtml = (text: string) => {
    const htmlEscapeMap: Record<string, string> = {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
    };

    return text.replace(/[&<>"']/g, (m) => htmlEscapeMap[m] ?? "");
};

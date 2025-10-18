import { type Request } from "express"
import debug from "debug"
const log = debug("server:serverUtilities")

export const pathToEntryFilename = (path: string) => {
  path = decodeURIComponent(path)
  if (!/^\//.test(path)) {
    throw new Error("Path must start with a leading slash")
  }
  if (path === "/") return "/index.html"

  // Only if there's no extension at all
  if (!/\.[a-zA-Z0-9]+$/.test(path)) {
    path = path + ".html"
  }

  return path
}

export const urlSearchParamsToRecord = (
  params: URLSearchParams,
): Record<string, string> => {
  const record: Record<string, string> = {}
  for (const [key, value] of params) {
    // When a query string has no value, e.g. `?raw`, its value is an empty string
    record[key] = value === "" ? key : value
  }
  return record
}

export const expressQueryToRecord = (
  reqQuery: Request["query"],
): Record<string, string> => {
  const query: Record<string, string> = {}
  for (const key in reqQuery) {
    if (typeof key != "string")
      throw new Error(`req.query key '${key}' was not a string.`)

    const value = reqQuery[key]
    if (typeof value != "string") {
      log(`req.query['${key}'] was not a string: ${reqQuery[key]}`)
      throw new Error(`req.query['${key}'] was not a string. See log`)
    }
    // When a query string has no value, e.g. `?raw`, its value is an empty string
    query[key] = value === "" ? key : value
  }
  return query
}

export const staticContentTypes = {
  plainText: "text/plain; charset=utf-8",
  // Causes a download
  arbitraryFile: "application/octet-stream",
} as const

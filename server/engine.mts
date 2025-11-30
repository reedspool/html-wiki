import { applyTemplating } from "./dom.mts"
import debug from "debug"
import { escapeHtml } from "./utilities.mts"
import {
  buildMyServerPStringContext,
  pString,
  specialRenderMarkdown,
} from "./queryLanguage.mts"
import { type FileCache } from "./fileCache.mts"
import { staticContentTypes } from "./serverUtilities.mts"
import { contentType } from "mime-types"
import { configuredFiles } from "./configuration.mts"
const log = debug("server:engine")

// Parameters come in tagged with a source to enable specific diagnostic reports
// on where certain values came from. Parameters are validated to turn into a
// much more specifically typed Request
export type ParameterValue = Record<string | number | symbol, unknown>
export type ParametersWithSource = [string, ParameterValue]

// The high level operation to perform
export type Command =
  | "create" // Write to a new file
  | "read" // Get file contents
  | "update" // Write to an existing file
  | "delete" // Delete

export const Status = {
  ServerError: 500, // Mysterious/hidden error
  ClientError: 400, // Request isn't right
  NotFound: 404, // File not found
  OK: 200, // Success
} as const
export type Status = typeof Status

export type Result = {
  // A shorthand signifier for what the result signifies
  status: Status[keyof Status]
  // The complete stringified result. Not necessarily the content rendered.
  content: string
  // The content path which was acted on
  contentPath?: string
  contentType: string
}
export const execute = async ({
  parameters,
  fileCache,
}: {
  parameters: ParameterValue
  fileCache: FileCache
}): Promise<Result> => {
  // NOTE: Despite TypeScript, it's on us to explicitly validate every property

  log("Engine executing parameters: %O", {
    ...parameters,
    content: parameters.content
      ? parameters.content.toString().slice(0, 20) + "..."
      : undefined,
  })
  const validationIssues: Array<string> = []
  if (!parameters.contentPath && !parameters.contentPathOrContentTitle) {
    // None present
    validationIssues.push(
      "Exactly one of contentPath or contentPathOrContentTitle required",
    )
  } else if (!parameters.contentPath) {
    // Try as title
    parameters.contentPath = await contentPathOrContentTitleToContentPath({
      fileCache,
      contentPathOrContentTitle: stringParameterValue(
        parameters,
        "contentPathOrContentTitle",
      ),
    })
  }

  // TODO: Really don't want this to be everywhere
  if (/\.md$/.test(stringParameterValue(parameters, "contentPath"))) {
    setParameterWithSource(parameters, "renderMarkdown", "true", "derived")
  }
  let command: Command | undefined = narrowStringToCommand(
    stringParameterValue(parameters, "command"),
  )
  if (!command) {
    validationIssues.push(`command must be one of ${commands}`)
  }
  switch (command) {
    case "create": {
      // TODO: Whoops reusing this special value
      if (!parameters.content) {
        validationIssues.push("content required")
      }
      if (stringParameterValue(parameters, "contentPath").charAt(0) !== "/") {
        setParameterWithSource(
          parameters,
          "contentPath",
          "/" + stringParameterValue(parameters, "contentPath"),
          "derived",
        )
      }
      if (validationIssues.length > 0)
        return validationErrorResponse(validationIssues)

      await fileCache.createFileAndDirectories({
        contentPath: stringParameterValue(parameters, "contentPath"),
        content: stringOrBufferParameterValue(parameters, "content"),
      })
      return {
        status: Status.OK,
        content: `File <a href="${stringParameterValue(parameters, "contentPath")}">${stringParameterValue(parameters, "contentPath")}</a> created successfully`,
        contentPath: stringParameterValue(parameters, "contentPath"),
        contentType: staticContentTypes.plainText,
      }
    }
    case "read": {
      await validateReadParameters(validationIssues, parameters, fileCache)
      if (validationIssues.length > 0)
        return validationErrorResponse(validationIssues)
      const { originalContent, meta } = fileCache.ensureByContentPath(
        stringParameterValue(parameters, "contentPath"),
      )
      let content
      let nocontainer = parameters.nocontainer !== undefined
      if (parameters.raw !== undefined) {
        if (parameters.escape !== undefined) {
          content = escapeHtml(originalContent.content)
        } else {
          content = originalContent.content
        }
      } else if (parameters.renderMarkdown !== undefined) {
        if (typeof parameters.contentPath !== "string") throw new Error()
        content = await specialRenderMarkdown({
          contentPath: parameters.contentPath,
          fileCache,
          content: originalContent.content,
        })
      } else {
        const templateApplicationResults = await applyTemplating({
          fileCache,
          content: originalContent.content,
          parameters: parameters,
        })
        content = templateApplicationResults.content
        if (templateApplicationResults.meta.nocontainer) nocontainer = true
      }
      let resultContentType =
        contentType(
          stringParameterValue(parameters, "contentPath").match(/\.[^.]+$/)![0],
        ) || staticContentTypes.plainText
      if (!nocontainer) {
        const containerExecuteResults = await execute({
          fileCache,
          parameters: {
            // TODO: Can't just do anything here. If I accept all previous
            // parameters, then I get into recursive loops. Why did I want that anyways?
            // The idea was to maybe pass some parameters to the top. So maybe  I can have a way to explicitly pass parameters up and out
            statusMessage: parameters.statusMessage,
            renderMarkdown: undefined,
            command: "read",
            select: undefined,
            contentPathOrContentTitle: undefined,
            contentPath: configuredFiles.defaultPageTemplate,
            content,
          },
        })
        content = containerExecuteResults.content
        resultContentType = containerExecuteResults.contentType
      }
      return {
        status: Status.OK,
        content,
        contentType: resultContentType,
      }
    }
    case "update": {
      if (!parameters.content) {
        validationIssues.push("content required")
      }
      if (validationIssues.length > 0)
        return validationErrorResponse(validationIssues)
      await fileCache.updateFile({
        contentPath: stringParameterValue(parameters, "contentPath"),
        content: stringParameterValue(parameters, "content"),
      })
      return {
        status: Status.OK,
        content: `File <a href="${stringParameterValue(parameters, "contentPath")}">${stringParameterValue(parameters, "contentPath")}</a> updated successfully`,
        contentPath: stringParameterValue(parameters, "contentPath"),
        contentType: staticContentTypes.plainText,
      }
    }
    case "delete": {
      if (validationIssues.length > 0)
        return validationErrorResponse(validationIssues)
      await fileCache.removeFile({
        contentPath: stringParameterValue(parameters, "contentPath"),
      })
      return {
        status: Status.OK,
        content: `File <a href="${stringParameterValue(parameters, "contentPath")}">${stringParameterValue(parameters, "contentPath")}</a> deleted successfully`,
        contentType: staticContentTypes.plainText,
      }
    }
    default:
      throw new Error(
        `Unhandled command '${stringParameterValue(parameters, "command")}'`,
      )
  }
}

export const contentPathOrContentTitleToContentPath = async ({
  fileCache,
  contentPathOrContentTitle,
}: {
  fileCache: FileCache
  contentPathOrContentTitle: string
}): Promise<string | undefined> => {
  return (
    fileCache.getByContentPathOrContentTitle(contentPathOrContentTitle)
      ?.contentPath ?? contentPathOrContentTitle
  )
}

export const validationErrorResponse = (validationIssues: Array<string>) => ({
  status: Status.ClientError,
  content: `Templating engine request wasn't valid, issues: ${validationIssues.join("; ")}.`,
  contentType: staticContentTypes.plainText,
})
export const validateReadParameters = async (
  validationIssues: Array<string>,
  parameters: ParameterValue,
  fileCache: FileCache,
) => {
  if (!parameters.contentPath && !parameters.contentPathOrContentTitle) {
    // None present
    validationIssues.push(
      "Exactly one of contentPath or contentPathOrContentTitle required",
    )
  } else if (!parameters.contentPath) {
    // Try as title
    parameters.contentPath = await contentPathOrContentTitleToContentPath({
      fileCache,
      contentPathOrContentTitle: stringParameterValue(
        parameters,
        "contentPathOrContentTitle",
      ),
    })
  }
  // TODO: Really don't want this to be everywhere
  if (/\.md$/.test(stringParameterValue(parameters, "contentPath"))) {
    setParameterWithSource(parameters, "renderMarkdown", "true", "derived")
  }
}

const commands = ["create", "read", "update", "delete"] as const
export const narrowStringToCommand: (
  maybeCommand: unknown,
) => Command | undefined = (maybeCommand) => {
  if (typeof maybeCommand !== "string") return undefined
  let command: Command | undefined
  for (const cmd of commands) {
    command = maybeCommand == cmd ? maybeCommand : command
  }
  return command
}

export type ParameterSources =
  | "derived"
  | "query param"
  | "request body"
  | "url facts"
  | "server configured"
export const setParameterWithSource = (
  parameters: ParameterValue | string,
  key: keyof ParameterValue,
  value: ParameterValue[string],
  source: ParameterSources,
): ParameterValue => {
  if (typeof parameters === "string")
    throw new Error(`Can't set parameter on ${parameters}`)
  const original = parameters[key]
  if (original) {
    log(
      `Overwriting parameter '${String(key)}' to '${value}' (${source}) from '${original}' (original.source)`,
    )
  }

  parameters[key] = value
  return parameters
}

export const setEachParameterWithSource = (
  parameters: ParameterValue,
  record: Record<string, ParameterValue[string]>,
  source: ParameterSources,
): ParameterValue => {
  Object.entries(record).forEach(([key, value]) => {
    setParameterWithSource(parameters, key, value, source)
  })
  return parameters
}

export const setParameterChildrenWithSource = (
  parameters: ParameterValue | string,
  key: keyof ParameterValue,
  value: ParameterValue,
  source: ParameterSources,
): ParameterValue => {
  if (typeof parameters === "string")
    throw new Error(`Can't set parameter on ${parameters}`)
  const original = parameters[key]
  if (original) {
    log(
      `Overwriting parameter '${String(key)}' to '${value}' (${source}) from '${original}' (original.source)`,
    )
  }

  // TODO: I think this is no longer any different at all
  parameters[key] = value
  return parameters
}

export const stringParameterValue = (
  parameterV: unknown,
  property: string,
): string => {
  // Temporarily and carefully cast
  const parameterVCasted = parameterV as ParameterValue
  const parameter = property in parameterVCasted && parameterVCasted[property]
  if (typeof parameter !== "string")
    throw new Error(`String required for property '${property}'`)
  return parameter
}

export const stringOrBufferParameterValue = (
  parameterV: unknown,
  property: string,
): string | Buffer => {
  // Temporarily and carefully cast
  const parameterVCasted = parameterV as ParameterValue
  const parameter = property in parameterVCasted && parameterVCasted[property]
  if (typeof parameter !== "string" && !(parameter instanceof Buffer))
    throw new Error(`String or Buffer required for property '${property}'`)
  return parameter
}

export const maybeStringParameterValue = (
  parameterV: unknown,
  property: string,
): string | undefined => {
  // Temporarily and carefully cast
  const parameterVCasted = parameterV as ParameterValue
  const parameter = property in parameterVCasted && parameterVCasted[property]
  if (typeof parameter !== "string") return undefined
  return parameter
}

export const maybeAtLeastEmptyStringParameterValue = (
  parameterV: unknown,
  property: string,
): string | true | undefined => {
  const parameter = maybeStringParameterValue(parameterV, property)
  if (parameter === "") return true
  return parameter
}

// TODO: I don't think this has any value anymore... since anything can be an
// object in JavaScript.
export const recordParameterValue = (
  parameter: ParameterValue["string"],
): unknown => {
  if (!parameter) throw new Error("Object required")
  return parameter
}

export const maybeRecordParameterValue = (
  parameter: ParameterValue["string"],
): unknown | undefined => {
  if (!parameter) return undefined
  return parameter
}

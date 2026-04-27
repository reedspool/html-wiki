import { defineConfig, type UserConfig } from "tsdown"

const cliConfig: UserConfig = {
  entry: ["./server/cli.mts"],

  platform: "node",

  outDir: "tsdown-output",

  minify: false,

  failOnWarn: true,

  publint: true,
}

export default defineConfig([cliConfig])

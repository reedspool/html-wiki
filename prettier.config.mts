import { type Config } from "prettier"

export default {
  trailingComma: "all",
  useTabs: false,
  tabWidth: 2,
  overrides: [
    {
      files: ["*.js", "*.ts", "*.mts"],
      options: {
        semi: false,
      },
    },
    {
      files: ["*.html"],
      options: {
        tabWidth: 2,
      },
    },
  ],
} satisfies Config

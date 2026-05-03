import fs from "fs"

const filePath = "/Users/andresitopacheco/Desktop/workspace/Projects/conclave/opencode-original/packages/opencode/src/cli/cmd/tui/routes/session/index.tsx"
let content = fs.readFileSync(filePath, "utf8")

const showBlockRegex = /<Show when=\{debateStatus\(\)\}>[\s\S]*?<\/Show>\n/

const match = content.match(showBlockRegex)
if (!match) {
  console.log("Could not find debateStatus block!")
  process.exit(1)
}

const block = match[0]
content = content.replace(block, "")

const insertPoint = "</For>\n            </scrollbox>"
if (content.includes(insertPoint)) {
  content = content.replace(insertPoint, `</For>\n               ${block.trim()}\n            </scrollbox>`)
  fs.writeFileSync(filePath, content)
  console.log("Successfully moved debateStatus block!")
} else {
  console.log("Could not find insertion point!")
  process.exit(1)
}

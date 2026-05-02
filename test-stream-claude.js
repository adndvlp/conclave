import { spawn } from "child_process"

async function testClaude() {
  console.log("--- Testing Claude ---")
  const proc = spawn("claude", [
    "-p", "Write a short poem about coding.",
    "--tools", "",
    "--bare",
    "--output-format", "stream-json",
    "--verbose"
  ], {
    stdout: "pipe",
    stderr: "inherit"
  })

  proc.stdout.on("data", (chunk) => {
    console.log("STDOUT CHUNK:", chunk.toString())
  })

  await new Promise(r => proc.on("close", r))
}

testClaude()

import { spawn } from "child_process"

async function testGemini() {
  console.log("--- Testing Gemini ---")
  const proc = spawn("gemini", [
    "-p", "Write a short poem about coding.",
    "--output-format", "stream-json",
    "--approval-mode", "plan",
    "--skip-trust"
  ], {
    stdout: "pipe",
    stderr: "inherit"
  })

  proc.stdout.on("data", (chunk) => {
    console.log("STDOUT CHUNK:", chunk.toString())
  })

  await new Promise(r => proc.on("close", r))
}

testGemini()

import { spawn } from "child_process"

async function testGeminiLong() {
  console.log("--- Testing Gemini Long ---")
  const proc = spawn("gemini", [
    "-p", "Write a 500 word essay about the history of artificial intelligence.",
    "--output-format", "stream-json",
    "--approval-mode", "plan",
    "--skip-trust"
  ], {
    stdout: "pipe",
    stderr: "inherit"
  })

  proc.stdout.on("data", (chunk) => {
    console.log(`STDOUT CHUNK at ${Date.now()}:`, chunk.toString().substring(0, 100) + "...")
  })

  await new Promise(r => proc.on("close", r))
}

testGeminiLong()

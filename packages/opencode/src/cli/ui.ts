import z from "zod"
import { EOL } from "os"
import { NamedError } from "@opencode-ai/core/util/error"

const RED = "\x1b[38;2;220;38;38m"
const RESET = "\x1b[0m"

const wordmark = [
  `                                          `,
  `  ██████╗ ██████╗ ███╗   ██╗ ██████╗██╗      █████╗ ██╗   ██╗███████╗`,
  `  ██╔════╝██╔═══██╗████╗  ██║██╔════╝██║     ██╔══██╗██║   ██║██╔════╝`,
  `  ██║     ██║   ██║██╔██╗ ██║██║     ██║     ███████║██║   ██║█████╗  `,
  `  ██║     ██║   ██║██║╚██╗██║██║     ██║     ██╔══██║╚██╗ ██╔╝██╔══╝  `,
  `  ╚██████╗╚██████╔╝██║ ╚████║╚██████╗███████╗██║  ██║ ╚████╔╝ ███████╗`,
  `   ╚═════╝ ╚═════╝ ╚═╝  ╚═══╝ ╚═════╝╚══════╝╚═╝  ╚═╝  ╚═══╝  ╚══════╝`,
]

export const CancelledError = NamedError.create("UICancelledError", z.void())
export const Style = {
  TEXT_HIGHLIGHT: "\x1b[38;2;121;40;202m", // Lumina Purple
  TEXT_HIGHLIGHT_BOLD: "\x1b[38;2;121;40;202m\x1b[1m",
  TEXT_DIM: "\x1b[38;2;102;102;102m",
  TEXT_DIM_BOLD: "\x1b[38;2;102;102;102m\x1b[1m",
  TEXT_NORMAL: "\x1b[0m",
  TEXT_NORMAL_BOLD: "\x1b[1m",
  TEXT_WARNING: "\x1b[38;2;245;166;35m",
  TEXT_WARNING_BOLD: "\x1b[38;2;245;166;35m\x1b[1m",
  TEXT_DANGER: "\x1b[38;2;238;0;0m",
  TEXT_DANGER_BOLD: "\x1b[38;2;238;0;0m\x1b[1m",
  TEXT_SUCCESS: "\x1b[38;2;0;112;243m", // Vercel Blue
  TEXT_SUCCESS_BOLD: "\x1b[38;2;0;112;243m\x1b[1m",
  TEXT_INFO: "\x1b[38;2;0;112;243m",
  TEXT_INFO_BOLD: "\x1b[38;2;0;112;243m\x1b[1m",
}

export function println(...message: string[]) {
  print(...message)
  process.stderr.write(EOL)
}

export function print(...message: string[]) {
  blank = false
  process.stderr.write(message.join(" "))
}

let blank = false
export function empty() {
  if (blank) return
  println("" + Style.TEXT_NORMAL)
  blank = true
}

export function logo(pad?: string) {
  const result = []
  for (const row of wordmark) {
    if (pad) result.push(pad)
    if (process.stdout.isTTY || process.stderr.isTTY) {
      result.push(RED + row + RESET)
    } else {
      result.push(row)
    }
    result.push(EOL)
  }
  return result.join("").trimEnd()
}

export async function input(prompt: string): Promise<string> {
  const readline = require("readline")
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  return new Promise((resolve) => {
    rl.question(prompt, (answer: string) => {
      rl.close()
      resolve(answer.trim())
    })
  })
}

export function error(message: string) {
  if (message.startsWith("Error: ")) {
    message = message.slice("Error: ".length)
  }
  println(Style.TEXT_DANGER_BOLD + "Error: " + Style.TEXT_NORMAL + message)
}

export function markdown(text: string): string {
  return text
}

export * as UI from "./ui"

import { runProcess } from "./process-runner.js"
import type { Invocation } from "./types.js"

export function clipboardInvocations(text: string, platform = process.platform, wayland = Boolean(process.env.WAYLAND_DISPLAY)): Invocation[] {
  const cwd = process.cwd()
  if (platform === "win32") return [{
    command: "powershell.exe",
    args: ["-NoProfile", "-NonInteractive", "-Command", "[Console]::InputEncoding=[Text.UTF8Encoding]::new($false); Set-Clipboard -Value ([Console]::In.ReadToEnd())"],
    stdin: text,
    cwd,
  }]
  if (platform === "darwin") return [{ command: "pbcopy", args: [], stdin: text, cwd }]
  const linux = [
    { command: "wl-copy", args: [], stdin: text, cwd },
    { command: "xclip", args: ["-selection", "clipboard"], stdin: text, cwd },
    { command: "xsel", args: ["--clipboard", "--input"], stdin: text, cwd },
  ]
  return wayland ? linux : [linux[1]!, linux[2]!, linux[0]!]
}

export async function copyToClipboard(text: string, runner: typeof runProcess = runProcess): Promise<void> {
  for (const invocation of clipboardInvocations(text)) {
    try {
      const result = await runner(invocation, 10_000)
      if (result.exitCode === 0) return
    } catch { /* Try the next installed clipboard utility. */ }
  }
  throw new Error("Clipboard unavailable. On Linux, install wl-copy, xclip, or xsel and run inside a desktop session.")
}

/** Files only the current user can read: the credentials, and the keys that lock them. */
import { execFileSync } from "node:child_process";
import { chmodSync, renameSync, writeFileSync } from "node:fs";

/** Write a JSON file readable only by the current user where the system allows it. */
export function writePrivateFile(file: string, content: unknown, platform: NodeJS.Platform = process.platform): string {
  writeFileSync(file, JSON.stringify(content, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
  if (platform === "win32") {
    try {
      const user = process.env.USERNAME;
      if (!user) throw new Error("no USERNAME");
      // Remove inherited permissions and give access to this user only.
      execFileSync("icacls", [file, "/inheritance:r", "/grant:r", `${user}:F`], { stdio: "ignore", windowsHide: true });
      return "readable only by your Windows user";
    } catch {
      return "saved with the folder's normal Windows permissions (could not restrict them further)";
    }
  }
  chmodSync(file, 0o600);
  return "readable only by you (permissions 600)";
}

/** The same, all at once: a crash leaves the old file or the new one, never half of one. */
export function replacePrivateFile(file: string, content: unknown): void {
  const next = `${file}.new`;
  writePrivateFile(next, content);
  renameSync(next, file);
}

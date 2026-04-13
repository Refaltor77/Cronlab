import { NextResponse } from "next/server";
import { readFile, readdir, stat } from "fs/promises";
import { existsSync } from "fs";
import path from "path";

const LOG_DIR = path.join(process.env.HOME || "/Users/martins", ".cronlab/logs");

interface LogEntry {
  id: string;
  taskId: string;
  timestamp: string;
  command: string;
  stdout: string;
  stderr: string;
  type: "stdout" | "stderr" | "combined";
}

// GET — read execution logs from LaunchAgent log files
export async function GET() {
  const entries: LogEntry[] = [];

  if (!existsSync(LOG_DIR)) {
    return NextResponse.json({ history: [] });
  }

  try {
    const files = await readdir(LOG_DIR);
    const logFiles = files.filter((f) => f.endsWith(".stdout.log") || f.endsWith(".stderr.log"));

    // Group by task ID
    const taskIds = new Set<string>();
    for (const f of logFiles) {
      const taskId = f.replace(".stdout.log", "").replace(".stderr.log", "");
      taskIds.add(taskId);
    }

    for (const taskId of taskIds) {
      const stdoutPath = path.join(LOG_DIR, `${taskId}.stdout.log`);
      const stderrPath = path.join(LOG_DIR, `${taskId}.stderr.log`);

      let stdout = "";
      let stderr = "";
      let lastModified = new Date(0);

      if (existsSync(stdoutPath)) {
        const s = await stat(stdoutPath);
        if (s.size > 0) {
          const content = await readFile(stdoutPath, "utf-8");
          // Only take last 4000 chars to avoid huge responses
          stdout = content.slice(-4000);
          if (s.mtime > lastModified) lastModified = s.mtime;
        }
      }

      if (existsSync(stderrPath)) {
        const s = await stat(stderrPath);
        if (s.size > 0) {
          const content = await readFile(stderrPath, "utf-8");
          stderr = content.slice(-4000);
          if (s.mtime > lastModified) lastModified = s.mtime;
        }
      }

      // Skip if no output at all
      if (!stdout && !stderr) continue;

      // Get command from meta
      let command = taskId;
      const metaPath = path.join(LOG_DIR, `${taskId}.meta.json`);
      if (existsSync(metaPath)) {
        try {
          const meta = JSON.parse(await readFile(metaPath, "utf-8"));
          command = meta.comment || taskId;
        } catch {
          // ignore
        }
      }

      entries.push({
        id: `log-${taskId}`,
        taskId,
        timestamp: lastModified.toISOString(),
        command,
        stdout,
        stderr,
        type: stderr && !stdout ? "stderr" : stdout && !stderr ? "stdout" : "combined",
      });
    }
  } catch {
    // log dir issues
  }

  // Sort by most recent first
  entries.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  return NextResponse.json({ history: entries });
}

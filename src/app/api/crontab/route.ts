import { NextRequest, NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import { readFile, writeFile, readdir, unlink, mkdir } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import plist from "simple-plist";

const execAsync = promisify(exec);

const LAUNCH_AGENTS_DIR = path.join(
  process.env.HOME || "/Users/martins",
  "Library/LaunchAgents"
);
const LOG_DIR = path.join(process.env.HOME || "/Users/martins", ".cronlab/logs");
const LABEL_PREFIX = "com.cronlab.";

interface CronEntry {
  id: string;
  schedule: string;
  command: string;
  enabled: boolean;
  comment: string;
}

interface PlistCalendar {
  Minute?: number;
  Hour?: number;
  Day?: number;
  Month?: number;
  Weekday?: number;
}

function cronToPlistCalendar(schedule: string): PlistCalendar {
  const [min, hour, dom, mon, dow] = schedule.split(" ");
  const cal: PlistCalendar = {};
  if (min !== "*" && !min.includes("/")) cal.Minute = parseInt(min);
  if (hour !== "*" && !hour.includes("/")) cal.Hour = parseInt(hour);
  if (dom !== "*") cal.Day = parseInt(dom);
  if (mon !== "*") cal.Month = parseInt(mon);
  if (dow !== "*" && !dow.includes("-")) cal.Weekday = parseInt(dow);
  return cal;
}

function cronToInterval(schedule: string): number | null {
  const [min, hour, dom, mon, dow] = schedule.split(" ");
  // */N * * * * → every N minutes
  if (min.startsWith("*/") && hour === "*" && dom === "*" && mon === "*" && dow === "*") {
    return parseInt(min.slice(2)) * 60;
  }
  // * * * * * → every minute
  if (min === "*" && hour === "*" && dom === "*" && mon === "*" && dow === "*") {
    return 60;
  }
  return null;
}

function plistToSchedule(plistData: Record<string, unknown>): string {
  const interval = plistData.StartInterval as number | undefined;
  if (interval) {
    if (interval === 60) return "* * * * *";
    if (interval % 60 === 0) return `*/${interval / 60} * * * *`;
    return `every ${interval}s`;
  }

  const cal = (
    Array.isArray(plistData.StartCalendarInterval)
      ? plistData.StartCalendarInterval[0]
      : plistData.StartCalendarInterval
  ) as PlistCalendar | undefined;

  if (!cal) return "* * * * *";

  const min = cal.Minute !== undefined ? String(cal.Minute) : "*";
  const hour = cal.Hour !== undefined ? String(cal.Hour) : "*";
  const dom = cal.Day !== undefined ? String(cal.Day) : "*";
  const mon = cal.Month !== undefined ? String(cal.Month) : "*";
  const dow = cal.Weekday !== undefined ? String(cal.Weekday) : "*";

  return `${min} ${hour} ${dom} ${mon} ${dow}`;
}

function buildPlist(entry: CronEntry): Record<string, unknown> {
  const label = `${LABEL_PREFIX}${entry.id}`;
  const logOut = path.join(LOG_DIR, `${entry.id}.stdout.log`);
  const logErr = path.join(LOG_DIR, `${entry.id}.stderr.log`);

  const obj: Record<string, unknown> = {
    Label: label,
    ProgramArguments: ["/bin/zsh", "-l", "-c", entry.command],
    StandardOutPath: logOut,
    StandardErrorPath: logErr,
    EnvironmentVariables: {
      HOME: process.env.HOME || "/Users/martins",
      PATH: "/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin",
      LANG: "en_US.UTF-8",
    },
  };

  // Use StartInterval for */N patterns, StartCalendarInterval otherwise
  const interval = cronToInterval(entry.schedule);
  if (interval !== null) {
    obj.StartInterval = interval;
  } else {
    const cal = cronToPlistCalendar(entry.schedule);
    obj.StartCalendarInterval = cal;
  }

  return obj;
}

async function ensureDirs() {
  if (!existsSync(LOG_DIR)) {
    await mkdir(LOG_DIR, { recursive: true });
  }
}

function plistPath(id: string): string {
  return path.join(LAUNCH_AGENTS_DIR, `${LABEL_PREFIX}${id}.plist`);
}

async function loadAgent(id: string): Promise<void> {
  const p = plistPath(id);
  try {
    await execAsync(`launchctl load "${p}"`);
  } catch {
    // Already loaded or error
  }
}

async function unloadAgent(id: string): Promise<void> {
  const p = plistPath(id);
  try {
    await execAsync(`launchctl unload "${p}"`);
  } catch {
    // Not loaded or error
  }
}

async function isAgentLoaded(id: string): Promise<boolean> {
  try {
    const label = `${LABEL_PREFIX}${id}`;
    const { stdout } = await execAsync(`launchctl list "${label}" 2>/dev/null`);
    return stdout.includes(label);
  } catch {
    return false;
  }
}

// GET — list all cronlab launch agents
export async function GET() {
  await ensureDirs();
  const entries: CronEntry[] = [];

  try {
    const files = await readdir(LAUNCH_AGENTS_DIR);
    const cronlabFiles = files.filter(
      (f) => f.startsWith(LABEL_PREFIX) && f.endsWith(".plist")
    );

    for (const file of cronlabFiles) {
      try {
        const filePath = path.join(LAUNCH_AGENTS_DIR, file);
        const raw = await readFile(filePath, "utf-8");
        const data = plist.parse(raw) as Record<string, unknown>;
        const label = (data.Label as string) || "";
        const id = label.replace(LABEL_PREFIX, "");

        // Extract command from ProgramArguments
        const args = data.ProgramArguments as string[] | undefined;
        const command = args ? args[args.length - 1] : "";

        // Extract schedule
        const schedule = plistToSchedule(data);

        // Check if loaded
        const enabled = await isAgentLoaded(id);

        // Extract comment from metadata file
        let comment = "";
        const metaPath = path.join(LOG_DIR, `${id}.meta.json`);
        if (existsSync(metaPath)) {
          try {
            const meta = JSON.parse(await readFile(metaPath, "utf-8"));
            comment = meta.comment || "";
          } catch {
            // ignore
          }
        }

        entries.push({ id, schedule, command, enabled, comment });
      } catch {
        // Skip malformed plist
      }
    }
  } catch {
    // Directory might not exist
  }

  return NextResponse.json({ entries });
}

// POST — create a new launch agent
export async function POST(request: NextRequest) {
  await ensureDirs();
  const body = await request.json();
  const { schedule, command, comment } = body;

  if (!schedule || !command) {
    return NextResponse.json(
      { error: "schedule and command are required" },
      { status: 400 }
    );
  }

  const id = `task-${Date.now()}`;
  const entry: CronEntry = {
    id,
    schedule,
    command,
    enabled: true,
    comment: comment || "",
  };

  // Build and write plist
  const plistData = buildPlist(entry);
  const plistXml = plist.stringify(plistData);
  await writeFile(plistPath(id), plistXml, "utf-8");

  // Save metadata (comment)
  if (comment) {
    const metaPath = path.join(LOG_DIR, `${id}.meta.json`);
    await writeFile(metaPath, JSON.stringify({ comment }), "utf-8");
  }

  // Load the agent
  await loadAgent(id);

  return NextResponse.json({ entry });
}

// PATCH — enable/disable a launch agent
export async function PATCH(request: NextRequest) {
  const body = await request.json();
  const { id, enabled } = body;

  const p = plistPath(id);
  if (!existsSync(p)) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  if (enabled) {
    await loadAgent(id);
  } else {
    await unloadAgent(id);
  }

  const loaded = await isAgentLoaded(id);

  return NextResponse.json({ id, enabled: loaded });
}

// PUT — update an existing launch agent
export async function PUT(request: NextRequest) {
  await ensureDirs();
  const body = await request.json();
  const { id, schedule, command, comment } = body;

  const p = plistPath(id);
  if (!existsSync(p)) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  // Unload the old agent
  await unloadAgent(id);

  const entry: CronEntry = {
    id,
    schedule,
    command,
    enabled: true,
    comment: comment || "",
  };

  // Rewrite plist
  const plistData = buildPlist(entry);
  const plistXml = plist.stringify(plistData);
  await writeFile(plistPath(id), plistXml, "utf-8");

  // Update metadata
  const metaPath = path.join(LOG_DIR, `${id}.meta.json`);
  await writeFile(metaPath, JSON.stringify({ comment: comment || "" }), "utf-8");

  // Reload agent
  await loadAgent(id);

  return NextResponse.json({ entry });
}

// DELETE — remove a launch agent
export async function DELETE(request: NextRequest) {
  const body = await request.json();
  const { id } = body;

  // Unload first
  await unloadAgent(id);

  // Delete plist
  const p = plistPath(id);
  if (existsSync(p)) {
    await unlink(p);
  }

  // Delete meta
  const metaPath = path.join(LOG_DIR, `${id}.meta.json`);
  if (existsSync(metaPath)) {
    await unlink(metaPath);
  }

  // Delete logs
  const stdoutLog = path.join(LOG_DIR, `${id}.stdout.log`);
  const stderrLog = path.join(LOG_DIR, `${id}.stderr.log`);
  if (existsSync(stdoutLog)) await unlink(stdoutLog);
  if (existsSync(stderrLog)) await unlink(stderrLog);

  return NextResponse.json({ success: true });
}

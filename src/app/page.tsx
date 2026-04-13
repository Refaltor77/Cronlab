"use client";

import { useState, useEffect, useCallback } from "react";

interface CronEntry {
  id: string;
  schedule: string;
  command: string;
  enabled: boolean;
  comment: string;
}

interface LogEntry {
  id: string;
  taskId: string;
  timestamp: string;
  command: string;
  stdout: string;
  stderr: string;
  type: "stdout" | "stderr" | "combined";
}

type Tab = "tasks" | "create" | "history";

const SCHEDULE_PRESETS = [
  { label: "Chaque minute", value: "* * * * *" },
  { label: "Toutes les 5 min", value: "*/5 * * * *" },
  { label: "Toutes les 15 min", value: "*/15 * * * *" },
  { label: "Toutes les heures", value: "0 * * * *" },
  { label: "Chaque jour 9h", value: "0 9 * * *" },
  { label: "Chaque jour minuit", value: "0 0 * * *" },
  { label: "Lun-Ven 9h", value: "0 9 * * 1-5" },
  { label: "Chaque dimanche", value: "0 0 * * 0" },
  { label: "1er du mois", value: "0 0 1 * *" },
];

const CRON_FIELDS = [
  { name: "Minute", range: "0-59", placeholder: "*" },
  { name: "Heure", range: "0-23", placeholder: "*" },
  { name: "Jour", range: "1-31", placeholder: "*" },
  { name: "Mois", range: "1-12", placeholder: "*" },
  { name: "Semaine", range: "0-6", placeholder: "*" },
];

function describeCron(schedule: string): string {
  const parts = schedule.split(" ");
  if (parts.length !== 5) return schedule;
  const [min, hour, dom, mon, dow] = parts;

  if (schedule === "* * * * *") return "Chaque minute";
  if (min.startsWith("*/") && hour === "*" && dom === "*" && mon === "*" && dow === "*")
    return `Toutes les ${min.slice(2)} minutes`;
  if (min === "0" && hour.startsWith("*/") && dom === "*" && mon === "*" && dow === "*")
    return `Toutes les ${hour.slice(2)} heures`;
  if (min === "0" && !hour.startsWith("*") && dom === "*" && mon === "*" && dow === "*")
    return `Chaque jour à ${hour}h00`;
  if (min === "0" && hour === "9" && dom === "*" && mon === "*" && dow === "1-5")
    return "Lun-Ven à 9h00";
  if (min === "0" && hour === "0" && dom === "1" && mon === "*" && dow === "*")
    return "1er de chaque mois";
  if (min === "0" && hour === "0" && dom === "*" && mon === "*" && dow === "0")
    return "Chaque dimanche minuit";

  return schedule;
}

function formatTimestamp(ts: string): string {
  const d = new Date(ts);
  const now = new Date();
  const diff = now.getTime() - d.getTime();

  if (diff < 60000) return "il y a quelques secondes";
  if (diff < 3600000) return `il y a ${Math.floor(diff / 60000)} min`;
  if (diff < 86400000) return `il y a ${Math.floor(diff / 3600000)}h`;

  return d.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function Home() {
  const [activeTab, setActiveTab] = useState<Tab>("tasks");
  const [entries, setEntries] = useState<CronEntry[]>([]);
  const [history, setHistory] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  // Form state
  const [cronFields, setCronFields] = useState(["*", "*", "*", "*", "*"]);
  const [command, setCommand] = useState("");
  const [comment, setComment] = useState("");
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null);

  // Delete confirmation
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editFields, setEditFields] = useState(["*", "*", "*", "*", "*"]);
  const [editCommand, setEditCommand] = useState("");
  const [editComment, setEditComment] = useState("");
  const [editPreset, setEditPreset] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const schedule = cronFields.join(" ");
  const editSchedule = editFields.join(" ");

  const fetchEntries = useCallback(async () => {
    try {
      const res = await fetch("/api/crontab");
      const data = await res.json();
      setEntries(data.entries || []);
    } catch (e) {
      console.error("Failed to fetch crontab:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchHistory = useCallback(async () => {
    try {
      const res = await fetch("/api/crontab/history");
      const data = await res.json();
      setHistory(data.history || []);
    } catch (e) {
      console.error("Failed to fetch history:", e);
    }
  }, []);

  useEffect(() => {
    fetchEntries();
    fetchHistory();
  }, [fetchEntries, fetchHistory]);

  async function toggleEntry(id: string, enabled: boolean) {
    await fetch("/api/crontab", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, enabled }),
    });
    fetchEntries();
  }

  function startEdit(entry: CronEntry) {
    setEditingId(entry.id);
    setEditFields(entry.schedule.split(" "));
    setEditCommand(entry.command);
    setEditComment(entry.comment);
    setEditPreset(null);
    setDeleteConfirm(null);
  }

  function cancelEdit() {
    setEditingId(null);
  }

  function applyEditPreset(value: string) {
    setEditPreset(value);
    setEditFields(value.split(" "));
  }

  async function saveEdit() {
    if (!editingId || !editCommand.trim()) return;
    setSaving(true);
    await fetch("/api/crontab", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: editingId,
        schedule: editSchedule,
        command: editCommand.trim(),
        comment: editComment.trim(),
      }),
    });
    setSaving(false);
    setEditingId(null);
    fetchEntries();
  }

  async function deleteEntry(id: string) {
    await fetch("/api/crontab", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    setDeleteConfirm(null);
    fetchEntries();
  }

  async function createEntry(e: React.FormEvent) {
    e.preventDefault();
    if (!command.trim()) return;
    setCreating(true);

    await fetch("/api/crontab", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ schedule, command: command.trim(), comment: comment.trim() }),
    });

    setCronFields(["*", "*", "*", "*", "*"]);
    setCommand("");
    setComment("");
    setSelectedPreset(null);
    setCreating(false);
    setActiveTab("tasks");
    fetchEntries();
  }

  function applyPreset(value: string) {
    setSelectedPreset(value);
    setCronFields(value.split(" "));
  }

  const activeCount = entries.filter((e) => e.enabled).length;

  return (
    <div className="min-h-screen flex flex-col bg-white">
      {/* Header */}
      <header className="px-6 pt-8 pb-2">
        <div className="max-w-2xl mx-auto">
          <h1 className="text-lg font-semibold tracking-tight text-[--text]">Cronlab</h1>
          <p className="text-xs text-[--text-muted] mt-0.5">Tâches planifiées</p>
        </div>
      </header>

      {/* Tabs */}
      <nav className="px-6 mt-4 mb-6 border-b border-[--border]">
        <div className="max-w-2xl mx-auto flex gap-1">
          {([["tasks", "Tâches"], ["create", "Nouvelle"], ["history", "Historique"]] as const).map(([key, label]) => (
            <button
              key={key}
              className={`tab-btn ${activeTab === key ? "active" : ""}`}
              onClick={() => { setActiveTab(key); if (key === "history") fetchHistory(); }}
            >
              {label}
              {key === "tasks" && entries.length > 0 && (
                <span className="ml-1.5 text-xs text-[--text-muted]">{entries.length}</span>
              )}
            </button>
          ))}
        </div>
      </nav>

      {/* Content */}
      <main className="px-6 pb-12 flex-1">
        <div className="max-w-2xl mx-auto">

          {/* === Tasks === */}
          {activeTab === "tasks" && (
            <div className="animate-fade-in">
              {loading ? (
                <div className="py-16 flex justify-center">
                  <div className="w-5 h-5 border-2 border-[--border] border-t-[--text] rounded-full animate-spin" />
                </div>
              ) : entries.length === 0 ? (
                <div className="py-16 text-center">
                  <p className="text-sm text-[--text-secondary] mb-3">Aucune tâche planifiée</p>
                  <button className="btn-primary" onClick={() => setActiveTab("create")}>
                    Nouvelle tâche
                  </button>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {entries.map((entry) => (
                    <div key={entry.id} className="card">
                      {editingId === entry.id ? (
                        <div className="p-4">
                          <div className="flex items-center gap-2 mb-4">
                            <span className="text-xs font-medium text-[--amber]">Modification</span>
                            <div className="section-line" />
                          </div>

                          <div className="text-center mb-4 py-2 bg-[--bg-secondary] rounded-md">
                            <div className="cron-preview mb-0.5">{editSchedule}</div>
                            <div className="text-xs text-[--text-secondary]">{describeCron(editSchedule)}</div>
                          </div>

                          <div className="grid grid-cols-5 gap-2 mb-3">
                            {CRON_FIELDS.map((field, fi) => (
                              <div key={field.name}>
                                <label className="text-[10px] block mb-1 text-[--text-muted] uppercase tracking-wider">{field.name}</label>
                                <input
                                  className="cron-input text-center text-sm"
                                  value={editFields[fi]}
                                  onChange={(e) => { const n = [...editFields]; n[fi] = e.target.value; setEditFields(n); setEditPreset(null); }}
                                  placeholder={field.placeholder}
                                />
                              </div>
                            ))}
                          </div>

                          <div className="flex flex-wrap gap-1.5 mb-4">
                            {SCHEDULE_PRESETS.map((p) => (
                              <button
                                key={p.value} type="button"
                                className={`text-xs px-2.5 py-1 rounded-md border cursor-pointer transition-colors ${editPreset === p.value ? "bg-[--accent] text-white border-[--accent]" : "bg-white text-[--text-secondary] border-[--border] hover:border-[--border-focus]"}`}
                                onClick={() => applyEditPreset(p.value)}
                              >{p.label}</button>
                            ))}
                          </div>

                          <div className="mb-3">
                            <label className="text-[10px] block mb-1 text-[--text-muted] uppercase tracking-wider">Commande</label>
                            <input className="cron-input text-sm" value={editCommand} onChange={(e) => setEditCommand(e.target.value)} />
                          </div>
                          <div className="mb-4">
                            <label className="text-[10px] block mb-1 text-[--text-muted] uppercase tracking-wider">Label</label>
                            <input className="cron-input text-sm" style={{ fontFamily: "var(--font-sans)" }} value={editComment} onChange={(e) => setEditComment(e.target.value)} />
                          </div>

                          <div className="flex justify-end gap-2">
                            <button type="button" className="text-sm px-3 py-1.5 rounded-md border border-[--border] text-[--text-secondary] cursor-pointer hover:bg-[--bg-secondary]" onClick={cancelEdit}>Annuler</button>
                            <button type="button" className="btn-primary" disabled={!editCommand.trim() || saving} onClick={saveEdit}>
                              {saving ? "Sauvegarde..." : "Sauvegarder"}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1.5">
                                <span className={`status-dot ${entry.enabled ? "active" : "inactive"}`} />
                                <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${entry.enabled ? "bg-[--green-bg] text-[--green]" : "bg-[--bg-secondary] text-[--text-muted]"}`}>
                                  {entry.enabled ? "Actif" : "Inactif"}
                                </span>
                                {entry.comment && <span className="text-sm font-medium text-[--text] truncate">{entry.comment}</span>}
                              </div>
                              <div className="text-[13px] font-mono text-[--text-secondary] mb-1 truncate">
                                <span className="text-[--text]">{entry.schedule}</span>
                                <span className="text-[--text-muted] mx-2">&rarr;</span>
                                {entry.command}
                              </div>
                              <div className="text-xs text-[--text-muted]">{describeCron(entry.schedule)}</div>
                            </div>

                            <div className="flex items-center gap-1.5 flex-shrink-0">
                              <button className="p-1.5 rounded-md text-[--text-muted] hover:text-[--amber] hover:bg-[--amber-bg] cursor-pointer border-none bg-transparent transition-colors" onClick={() => startEdit(entry)} aria-label="Modifier">
                                <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M11.5 1.5l3 3-9 9H2.5v-3l9-9z" /></svg>
                              </button>
                              <button className={`toggle-track ${entry.enabled ? "active" : ""}`} onClick={() => toggleEntry(entry.id, !entry.enabled)} aria-label={entry.enabled ? "Désactiver" : "Activer"}>
                                <div className="toggle-thumb" />
                              </button>
                              {deleteConfirm === entry.id ? (
                                <div className="flex items-center gap-1.5">
                                  <button className="btn-danger" onClick={() => deleteEntry(entry.id)}>Supprimer</button>
                                  <button className="text-xs text-[--text-muted] cursor-pointer bg-transparent border-none" onClick={() => setDeleteConfirm(null)}>Non</button>
                                </div>
                              ) : (
                                <button className="p-1.5 rounded-md text-[--text-muted] hover:text-[--red] hover:bg-[--red-bg] cursor-pointer border-none bg-transparent transition-colors" onClick={() => setDeleteConfirm(entry.id)} aria-label="Supprimer">
                                  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 4.5h10M6.5 4.5V3a1 1 0 011-1h1a1 1 0 011 1v1.5M5 4.5v8a1 1 0 001 1h4a1 1 0 001-1v-8" /></svg>
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* === Create === */}
          {activeTab === "create" && (
            <div className="animate-fade-in">
              <form onSubmit={createEntry}>
                <div className="card p-5 mb-3 text-center">
                  <div className="text-[10px] mb-2 uppercase tracking-widest text-[--text-muted]">Expression cron</div>
                  <div className="cron-preview mb-1">{schedule}</div>
                  <div className="text-xs text-[--text-secondary]">{describeCron(schedule)}</div>
                </div>

                <div className="card p-5 mb-3">
                  <div className="flex items-center gap-3 mb-4">
                    <span className="text-sm font-medium text-[--text]">Planification</span>
                    <div className="section-line" />
                  </div>
                  <div className="grid grid-cols-5 gap-3 mb-4">
                    {CRON_FIELDS.map((field, i) => (
                      <div key={field.name}>
                        <label className="text-[10px] block mb-1 text-[--text-muted] uppercase tracking-wider">{field.name}</label>
                        <input className="cron-input text-center" value={cronFields[i]} onChange={(e) => { const n = [...cronFields]; n[i] = e.target.value; setCronFields(n); setSelectedPreset(null); }} placeholder={field.placeholder} />
                        <div className="text-[10px] mt-1 text-center text-[--text-muted]">{field.range}</div>
                      </div>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {SCHEDULE_PRESETS.map((p) => (
                      <button key={p.value} type="button"
                        className={`text-xs px-2.5 py-1 rounded-md border cursor-pointer transition-colors ${selectedPreset === p.value ? "bg-[--accent] text-white border-[--accent]" : "bg-white text-[--text-secondary] border-[--border] hover:border-[--border-focus]"}`}
                        onClick={() => applyPreset(p.value)}
                      >{p.label}</button>
                    ))}
                  </div>
                </div>

                <div className="card p-5 mb-3">
                  <div className="flex items-center gap-3 mb-4">
                    <span className="text-sm font-medium text-[--text]">Commande</span>
                    <div className="section-line" />
                  </div>
                  <div className="mb-3">
                    <label className="text-[10px] block mb-1 text-[--text-muted] uppercase tracking-wider">Commande à exécuter</label>
                    <input className="cron-input" value={command} onChange={(e) => setCommand(e.target.value)} placeholder="ex: claude -p 'check status' --allowedTools Read,Bash" />
                  </div>
                  <div>
                    <label className="text-[10px] block mb-1 text-[--text-muted] uppercase tracking-wider">Label (optionnel)</label>
                    <input className="cron-input" style={{ fontFamily: "var(--font-sans)" }} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="ex: Daily Claude Code health check" />
                  </div>
                </div>

                <div className="flex justify-end">
                  <button type="submit" className="btn-primary" disabled={!command.trim() || creating}>
                    {creating ? "Création..." : "Ajouter la tâche"}
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* === History === */}
          {activeTab === "history" && (
            <div className="animate-fade-in">
              {history.length === 0 ? (
                <div className="py-16 text-center">
                  <p className="text-sm text-[--text-secondary]">Aucun historique disponible</p>
                  <p className="text-xs text-[--text-muted] mt-1">Les logs apparaîtront après la première exécution</p>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {history.map((log) => (
                    <div key={log.id} className={`log-entry ${log.type === "stderr" ? "error" : "success"}`}>
                      <div className="card p-4">
                        <div className="flex items-center justify-between mb-1.5">
                          <div className="flex items-center gap-2">
                            <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${log.type === "stderr" ? "bg-[--red-bg] text-[--red]" : "bg-[--green-bg] text-[--green]"}`}>
                              {log.type === "stderr" ? "Erreur" : "OK"}
                            </span>
                            <span className="text-xs text-[--text-muted] bg-[--bg-secondary] px-1.5 py-0.5 rounded">{log.taskId}</span>
                          </div>
                          <span className="text-xs text-[--text-muted]">{formatTimestamp(log.timestamp)}</span>
                        </div>
                        <div className="text-[13px] font-mono text-[--text-secondary] truncate">
                          <span className="text-[--text-muted]">$</span> {log.command}
                        </div>
                        {(log.stdout || log.stderr) && (
                          <details className="mt-2">
                            <summary className="text-xs text-[--text-muted] cursor-pointer">Voir la sortie</summary>
                            {log.stdout && <pre className="mt-2 text-xs p-3 rounded-md bg-[--bg-secondary] text-[--text-secondary] font-mono overflow-x-auto max-h-60 overflow-y-auto">{log.stdout}</pre>}
                            {log.stderr && <pre className="mt-2 text-xs p-3 rounded-md bg-[--red-bg] text-[--red] font-mono overflow-x-auto max-h-60 overflow-y-auto">{log.stderr}</pre>}
                          </details>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="px-6 py-3 border-t border-[--border]">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <span className="text-xs text-[--text-muted]">Cronlab</span>
          <div className="flex items-center gap-1.5 text-xs text-[--text-muted]">
            <span className="status-dot active" />
            {activeCount} tâche{activeCount !== 1 ? "s" : ""} active{activeCount !== 1 ? "s" : ""}
          </div>
        </div>
      </footer>
    </div>
  );
}

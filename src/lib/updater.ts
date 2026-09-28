import { toast } from "sonner";
import { isTauri } from "./platform";

const LAST_CHECK = "voxstudio.update-check";
const DAY = 24 * 60 * 60 * 1000;

/**
 * Looks for a newer signed release. Silent checks (at launch) only speak up when there's an update;
 * manual checks also report "up to date" and errors.
 */
export async function checkForUpdates({ silent = false } = {}) {
  if (!isTauri) {
    if (!silent) toast("Updates are handled by the desktop app");
    return;
  }
  const { check } = await import("@tauri-apps/plugin-updater");
  let update: Awaited<ReturnType<typeof check>>;
  try {
    update = await check();
  } catch (e) {
    if (!silent)
      toast.error("Couldn’t check for updates", { description: String(e) });
    return;
  }
  try {
    localStorage.setItem(LAST_CHECK, String(Date.now()));
  } catch {
    /* storage unavailable */
  }
  if (!update) {
    if (!silent) toast.success("VoxStudio is up to date");
    return;
  }
  const found = update;
  toast(`VoxStudio ${found.version} is available`, {
    description:
      found.body?.split("\n")[0] || "Install it now; your work is kept.",
    duration: Infinity,
    action: { label: "Install & restart", onClick: () => void install(found) },
  });
}

async function install(update: {
  downloadAndInstall: (cb: (e: DownloadEvent) => void) => Promise<void>;
}) {
  let total = 0;
  let received = 0;
  const id = toast.loading("Downloading update…");
  try {
    await update.downloadAndInstall((e) => {
      if (e.event === "Started") total = e.data.contentLength ?? 0;
      if (e.event === "Progress") {
        received += e.data.chunkLength;
        if (total)
          toast.loading(
            `Downloading update… ${Math.round((received / total) * 100)}%`,
            { id },
          );
      }
      if (e.event === "Finished") toast.loading("Installing…", { id });
    });
    const { relaunch } = await import("@tauri-apps/plugin-process");
    await relaunch();
  } catch (e) {
    toast.error("The update couldn’t be installed", {
      id,
      description: String(e),
    });
  }
}

type DownloadEvent =
  | { event: "Started"; data: { contentLength?: number } }
  | { event: "Progress"; data: { chunkLength: number } }
  | { event: "Finished" };

/** At most once a day, and never in development builds. */
export function maybeCheckOnLaunch(enabled: boolean) {
  if (!isTauri || !enabled || import.meta.env.DEV) return;
  let last = 0;
  try {
    last = Number(localStorage.getItem(LAST_CHECK) ?? 0);
  } catch {
    /* storage unavailable */
  }
  if (Date.now() - last > DAY)
    setTimeout(() => void checkForUpdates({ silent: true }), 8000);
}

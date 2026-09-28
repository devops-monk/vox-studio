import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  AudioLines,
  CornerDownLeft,
  Loader2,
  Play,
  Square,
} from "lucide-react";
import { VoiceOrb } from "@/components/voice-orb";
import { usePlayer } from "@/lib/audio/player";
import { quick } from "@/lib/quick";
import { usePrefs } from "@/lib/store/prefs";
import { useApplyAppearance, useApplyTheme } from "@/lib/use-theme";
import { voxd } from "@/lib/voxd/client";
import { useCustomVoices, useEngines, useVoices } from "@/lib/voxd/queries";
import { useVoxd } from "@/lib/voxd/state";
import type { Take } from "@/lib/voxd/types";
import { cn } from "@/lib/cn";

const MAX_CHARS = 5000;
const recent: string[] = []; // this session's phrases, for ↑ / ↓

/** A voice option: "<engine>|<voice id>". */
const key = (engine: string, voice: string) => `${engine}|${voice}`;

function useVoiceOptions() {
  const engines = useEngines().data ?? [];
  const has = (id: string) => engines.some((e) => e.id === id && e.available);
  const kokoro = useVoices(has("kokoro") ? "kokoro" : "").data ?? [];
  const system = useVoices("system").data ?? [];
  const custom = useCustomVoices().data ?? [];
  return useMemo(() => {
    const groups: {
      label: string;
      options: { value: string; label: string }[];
    }[] = [];
    if (has("kokoro") && kokoro.length)
      groups.push({
        label: "Natural",
        options: kokoro.map((v) => ({
          value: key("kokoro", v.id),
          label: `${v.name} · ${v.language}`,
        })),
      });
    if (has("chatterbox"))
      groups.push({
        label: "Your voices",
        options: [
          ...custom.map((v) => ({
            value: key("chatterbox", v.id),
            label: v.name,
          })),
          { value: key("chatterbox", "default"), label: "Chatterbox Default" },
        ],
      });
    if (system.length)
      groups.push({
        label: "System",
        options: system.map((v) => ({
          value: key("system", v.id),
          label: `${v.name} · ${v.language}`,
        })),
      });
    return groups;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engines, kokoro, system, custom]);
}

/** Spotlight-style panel in its own window: type, press Return, hear it. */
export function QuickSpeak() {
  useApplyTheme();
  useApplyAppearance();
  const ready = useVoxd((s) => s.state.phase === "ready");
  const { engine, voiceByEngine, setEngine, setVoice } = usePrefs();
  const groups = useVoiceOptions();
  const { current, analyser, play, stop } = usePlayer();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [take, setTake] = useState<Take | null>(null);
  const recall = useRef(-1);
  const input = useRef<HTMLTextAreaElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  const firstVoice = groups
    .flatMap((g) => g.options)
    .find((o) => o.value.startsWith(`${engine}|`))
    ?.value.split("|")[1];
  const voice = voiceByEngine[engine] ?? firstVoice ?? "";
  const selected = key(engine, voice);
  const speaking = !!take && current === take.id;

  useEffect(() => {
    document.documentElement.dataset.pill = "true"; // transparent around the panel
  }, []);

  // Each time the shortcut shows the panel: pick up settings changed in the main window, focus, select.
  useEffect(() => {
    let off: (() => void) | undefined;
    if (quick.available)
      void (async () => {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const win = getCurrentWindow();
        const offOpen = await win.listen("quick://open", () => {
          void usePrefs.persist.rehydrate();
          setError("");
          requestAnimationFrame(() => input.current?.select());
        });
        const offPending = await win.listen(
          "quick://pending",
          () => void takePending(),
        );
        void takePending(); // Speak Selection may have opened this window
        off = () => (offOpen(), offPending(), offFocus());
        // Like Spotlight, clicking elsewhere puts it away (audio keeps playing).
        const offFocus = await win.onFocusChanged(
          ({ payload: focused }) => !focused && void quick.hide(),
        );
      })();
    requestAnimationFrame(() => input.current?.focus());
    return () => off?.();
  }, []);

  // The window is exactly as tall as the panel.
  useLayoutEffect(() => {
    const el = panel.current;
    if (!el || !quick.available) return;
    const ro = new ResizeObserver(
      () =>
        void quick.resize(Math.ceil(el.getBoundingClientRect().height) + 16),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Grow the text box with its content (up to 5 lines).
  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 5 * 22 + 8)}px`;
  }, [text]);

  const speak = async (override?: string) => {
    const t = (override ?? text).trim();
    if (!t || busy || !ready) return;
    setBusy(true);
    setError("");
    try {
      const result = await voxd.speak({
        text: t.slice(0, MAX_CHARS),
        voice,
        engine,
        speed: 1,
      });
      setTake(result);
      if (recent[0] !== t) recent.unshift(t);
      recall.current = -1;
      await play(result.id, voxd.audioUrl(result));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // Speak Selection: the shell copied the selected text for us.
  const pendingRef = useRef<() => Promise<void>>(async () => {});
  pendingRef.current = async () => {
    const pending = await quick.takePending().catch(() => null);
    if (!pending) return;
    if (pending.notice) {
      setError(pending.notice);
      return;
    }
    if (pending.text) {
      const t = pending.text.trim().slice(0, MAX_CHARS);
      setText(t);
      if (useVoxd.getState().state.phase === "ready") void speak(t);
      else queued.current = t; // the engine is still starting; speak once it's ready
    }
  };
  const queued = useRef<string | null>(null);
  useEffect(() => {
    if (ready && queued.current) {
      const t = queued.current;
      queued.current = null;
      void speak(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);
  const takePending = () => pendingRef.current();

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void speak();
    } else if (e.key === "Escape") {
      e.preventDefault();
      if (speaking) stop();
      else void quick.hide();
    } else if (
      (e.key === "ArrowUp" || e.key === "ArrowDown") &&
      !text.includes("\n") &&
      recent.length
    ) {
      const next = Math.max(
        -1,
        Math.min(
          recent.length - 1,
          recall.current + (e.key === "ArrowUp" ? 1 : -1),
        ),
      );
      if (next === recall.current) return;
      e.preventDefault();
      recall.current = next;
      setText(next === -1 ? "" : recent[next]);
    }
  };

  const openInStudio = () => {
    void quick.openLink(
      `voxstudio://studio?text=${encodeURIComponent(text.trim())}`,
    );
    void quick.hide();
  };

  return (
    <div className="p-2">
      <div
        ref={panel}
        className="glass-pop overflow-hidden rounded-[20px] shadow-[0_24px_80px_rgba(0,0,0,0.35),0_0_0_0.5px_var(--hairline-strong)]"
      >
        <div className="flex items-start gap-3 px-4 py-3">
          <div className="mt-0.5 shrink-0">
            <VoiceOrb
              mode={
                busy ? "busy" : speaking ? "speaking" : error ? "error" : "idle"
              }
              analyser={speaking ? analyser : null}
              size={34}
            />
          </div>
          <textarea
            ref={input}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKey}
            rows={1}
            maxLength={MAX_CHARS}
            placeholder={
              ready
                ? "Type something to hear it…"
                : "Starting the voice engine…"
            }
            aria-label="Text to speak"
            spellCheck
            className="min-h-[38px] flex-1 resize-none bg-transparent py-1.5 focus-visible:outline-none font-[var(--font-display)] text-[20px] leading-[22px] tracking-[-0.01em] outline-none placeholder:text-text-3"
          />
          <button
            type="button"
            onClick={() => (speaking ? stop() : void speak())}
            disabled={(!text.trim() && !speaking) || busy || !ready}
            aria-label={speaking ? "Stop" : "Speak"}
            className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-full bg-accent text-white shadow-[0_4px_14px_color-mix(in_srgb,var(--accent)_45%,transparent)] transition-transform active:scale-95 disabled:opacity-35 disabled:shadow-none"
          >
            {busy ? (
              <Loader2 size={16} className="animate-spin" />
            ) : speaking ? (
              <Square size={13} fill="currentColor" />
            ) : (
              <Play size={15} fill="currentColor" className="ml-0.5" />
            )}
          </button>
        </div>
        <div className="flex items-center gap-2 border-t-[0.5px] border-hairline bg-[color-mix(in_srgb,var(--fill-control)_60%,transparent)] px-3 py-1.5 text-[11px] text-text-3">
          <AudioLines size={12} />
          <select
            value={selected}
            onChange={(e) => {
              const [eng, v] = e.target.value.split("|");
              setEngine(eng);
              setVoice(eng, v);
            }}
            aria-label="Voice"
            className="max-w-64 truncate rounded-[6px] bg-transparent py-0.5 font-medium text-text-2 outline-none hover:bg-fill-hover"
          >
            {groups.map((g) => (
              <optgroup key={g.label} label={g.label}>
                {g.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          {error ? (
            <span
              className="min-w-0 flex-1 truncate text-[#ff453a]"
              title={error}
            >
              {error}
            </span>
          ) : (
            <span className="flex-1" />
          )}
          {take && !busy && (
            <button
              type="button"
              onClick={() => void play(take.id, voxd.audioUrl(take))}
              className="rounded-[5px] px-1.5 py-0.5 hover:bg-fill-hover hover:text-text-1"
            >
              Replay
            </button>
          )}
          <button
            type="button"
            disabled={!text.trim()}
            onClick={openInStudio}
            className={cn(
              "rounded-[5px] px-1.5 py-0.5 hover:bg-fill-hover hover:text-text-1 disabled:opacity-40",
            )}
          >
            Open in Studio
          </button>
          <span className="flex items-center gap-1 pl-1">
            <CornerDownLeft size={11} /> speak · esc close
          </span>
        </div>
      </div>
    </div>
  );
}

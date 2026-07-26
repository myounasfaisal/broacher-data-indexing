import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  ArrowDown,
  BookMarked,
  Bot,
  Check,
  ChevronRight,
  ClipboardCheck,
  Copy,
  Eye,
  FileSearch,
  ListTree,
  RotateCcw,
  Scale,
  Search,
  Send,
  Sparkles,
  Square,
  TriangleAlert,
  Users,
  X,
} from "lucide-react";
import {
  api,
  type ChatEvent,
  type ChatReply,
  type InspectorContext,
} from "@/lib/api";
import type { Listing } from "@/types/chemical";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatPrice } from "@/components/search/ResultsTable";

/**
 * Sourcing assistant docked in the Search screen.
 *
 * TRUST BOUNDARY: the assistant's prose is rendered as text, but every product
 * it refers to comes back as a real `Listing` row fetched server-side by id —
 * the backend drops any id its tools didn't actually return. So the numbers on
 * screen are the database's, never the model's. See services/chat_agent.py.
 *
 * The chat is ephemeral by design: closing the panel destroys the thread
 * server-side. There is no history feature; the audit log keeps the record.
 *
 * THREE THINGS THIS SURFACE OWES THE USER, all of which are trust mechanics
 * rather than decoration:
 *
 *  1. Show what the assistant can SEE (the context strip). The panel sends the
 *     active filters and the selected row on every turn, which is what makes
 *     "is this one any good?" resolve. Sending that invisibly means the user
 *     cannot tell whether the pronoun will land.
 *  2. KEEP the activity trail after the answer arrives, collapsed. It is the
 *     evidence of what was actually searched; discarding it at exactly the
 *     moment the user might want to check the answer is backwards.
 *  3. Leave a visible trace when something fails or is cancelled. A toast that
 *     fades and a transcript that silently loses the question is the worst of
 *     both.
 */

interface Turn {
  role: "user" | "assistant";
  text: string;
  listings?: Listing[];
  /** Completed lookups for an assistant turn — kept, not discarded. */
  steps?: Step[];
  /** Assistant turns only. `ok` unless the run failed or the user stopped it. */
  status?: "ok" | "error" | "stopped";
}

/**
 * One step in the assistant's live activity trail. Every entry is driven by a
 * real event from the agent loop — the labels below describe what it actually
 * ran, so nothing here is invented to fill silence.
 */
interface Step {
  key: string;
  /** `think` steps are model turns; `tool` steps are real lookups. */
  kind: "think" | "tool";
  icon: typeof Search;
  label: string;
  done: boolean;
  /** Result summary, filled in when the step finishes. */
  result?: string;
}

const TOOL_META: Record<string, { icon: typeof Search; verb: string }> = {
  search_catalog: { icon: Search, verb: "Searching the catalog" },
  compare_suppliers: { icon: Users, verb: "Comparing suppliers" },
  list_detail_keys: { icon: ListTree, verb: "Checking product attributes" },
  get_listing_provenance: { icon: FileSearch, verb: "Tracing the source page" },
  // Semantic neighbours (P3). Named "similar", never "matching": the score
  // measures wording, not equivalence.
  find_similar_chemicals: { icon: Sparkles, verb: "Looking for similar products" },
  // House knowledge — our own recorded decisions.
  lookup_substitution_notes: { icon: BookMarked, verb: "Reading our substitution notes" },
  lookup_regulatory_notes: { icon: Scale, verb: "Checking our regulatory notes" },
};

const SUGGESTIONS = [
  "Which suppliers carry an epoxy hardener for tile adhesive?",
  "What do we stock for floor coatings?",
  "What can replace titanium dioxide?",
];

export function ChatPanel({
  context,
  onOpenListing,
  onClose,
}: {
  /** Live Inspector state — current filters and selected row. */
  context: InspectorContext;
  onOpenListing: (id: string) => void;
  onClose: () => void;
}) {
  const [threadId, setThreadId] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [steps, setSteps] = useState<Step[]>([]);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [full, setFull] = useState(false);
  /** False once the user scrolls up — see `pinned` below. */
  const [pinned, setPinned] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Keep the latest context in a ref so `send` never closes over a stale
  // snapshot — filters change while the panel is open.
  const contextRef = useRef(context);
  contextRef.current = context;

  // The panel opens because the user asked a question they already have in
  // mind. Landing the caret in the composer saves a click every single time.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  /**
   * Follow the conversation ONLY while the user is already at the bottom.
   *
   * Unconditional auto-scroll is the classic chat bug: scroll up to re-read a
   * cited row while the assistant works, and the next event yanks you away.
   * When they have scrolled up we leave them alone and surface a jump button
   * instead.
   */
  useLayoutEffect(() => {
    if (!pinned) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [turns, busy, steps, pinned]);

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    // 24px of slack: "close enough to the bottom" survives sub-pixel rounding
    // and the elastic overscroll on trackpads.
    setPinned(el.scrollHeight - el.scrollTop - el.clientHeight < 24);
  }

  function jumpToLatest() {
    setPinned(true);
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }

  // Closing the panel destroys the thread. Also runs on unmount (navigating
  // away), which is the same intent — the user is done with this chat.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      if (threadId) void api.closeChatThread(threadId);
    };
  }, [threadId]);

  async function ensureThread(): Promise<string> {
    if (threadId) return threadId;
    const thread = await api.openChatThread();
    setThreadId(thread.thread_id);
    setRemaining(thread.messages_remaining);
    return thread.thread_id;
  }

  const send = useCallback(async function send(question: string) {
    const q = question.trim();
    if (!q || busy || full) return;

    setText("");
    setPinned(true);
    setTurns((t) => [...t, { role: "user", text: q }]);
    setSteps([]);
    setBusy(true);

    const controller = new AbortController();
    abortRef.current = controller;
    // The trail is accumulated here as well as in state: `finally` needs the
    // final value to attach to the turn, and the state setter is async.
    let trail: Step[] = [];

    try {
      const id = await ensureThread();
      const reply: ChatReply = await api.streamChatMessage(
        id,
        q,
        contextRef.current,
        (event) => {
          trail = reduceEvent(trail, event);
          setSteps(trail);
        },
        controller.signal,
      );
      setTurns((t) => [
        ...t,
        {
          role: "assistant",
          text: reply.answer,
          listings: reply.listings,
          steps: trail,
          status: "ok",
        },
      ]);
      setRemaining(reply.messages_remaining);
      if (reply.messages_remaining <= 0) setFull(true);
    } catch (err) {
      const aborted =
        controller.signal.aborted ||
        (err instanceof DOMException && err.name === "AbortError");

      if (aborted) {
        // The user's own decision, not a failure: no toast, and the turn stays
        // in the transcript so the thread reads honestly.
        setTurns((t) => [
          ...t,
          { role: "assistant", text: "Stopped.", steps: trail, status: "stopped" },
        ]);
      } else {
        const msg = err instanceof Error ? err.message : "The assistant failed.";
        // A thread that expired or filled up isn't a failure the user caused —
        // offer the recovery instead of just reporting an error.
        if (/expired|limit/i.test(msg)) setFull(true);
        toast.error(msg);
        // The failure ALSO lands in the transcript. A toast alone disappears,
        // leaving a question with no answer and no explanation beside it.
        setTurns((t) => [
          ...t,
          { role: "assistant", text: msg, steps: trail, status: "error" },
        ]);
      }
    } finally {
      abortRef.current = null;
      setBusy(false);
      setSteps([]);
    }
  }, [busy, full, threadId]);

  /** Re-ask the question that produced a failed or stopped turn. */
  function retry(index: number) {
    const question = turns[index - 1]?.text;
    if (!question) return;
    setTurns((t) => t.slice(0, index));
    void send(question);
  }

  function newChat() {
    abortRef.current?.abort();
    if (threadId) void api.closeChatThread(threadId);
    setThreadId(null);
    setTurns([]);
    setRemaining(null);
    setFull(false);
    setText("");
    setPinned(true);
    inputRef.current?.focus();
  }

  const contextChips = describeContext(context);

  return (
    <div
      className="flex h-full flex-col border-l border-line bg-surface"
      // Escape closes — the standard exit for a dismissible overlay, and the
      // only one available on a phone where this covers the whole screen.
      // Scoped to this subtree rather than the window: the product Inspector
      // sits ABOVE this panel and closes on Escape through its own document
      // listener, so a global handler here would collapse both at once.
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <header className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <Bot className="h-4 w-4 shrink-0 text-brand" aria-hidden />
          <h2 className="truncate text-sm font-medium">Sourcing assistant</h2>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {turns.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={newChat}
              title="Start a new chat"
            >
              <RotateCcw className="h-4 w-4" aria-hidden />
              <span className="sr-only">New chat</span>
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={onClose} title="Close (Esc)">
            <X className="h-4 w-4" aria-hidden />
            <span className="sr-only">Close assistant</span>
          </Button>
        </div>
      </header>

      {/*
        What the assistant can see. This is the mechanism that makes "is this
        one any good?" resolve without retyping a chemical name — and it was
        previously invisible, so the user had to guess whether a pronoun would
        land. Shown only when there is something to show: an empty strip would
        be chrome that never earns its row.
      */}
      {contextChips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-app/60 px-4 py-2">
          <Eye className="h-3 w-3 shrink-0 text-fg-subtle" aria-hidden />
          <span className="text-xs text-fg-muted">It can see</span>
          {contextChips.map((chip) => (
            <span
              key={chip.label}
              title={`${chip.kind}: ${chip.label}`}
              className="max-w-[14rem] truncate rounded-chip bg-muted px-1.5 py-0.5 text-xs text-fg-muted"
            >
              {chip.label}
            </span>
          ))}
        </div>
      )}

      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="relative flex-1 space-y-4 overflow-y-auto px-4 py-4"
      >
        {turns.length === 0 && !busy && (
          <EmptyState onPick={(s) => void send(s)} />
        )}

        {turns.map((turn, i) =>
          turn.role === "user" ? (
            <p
              key={i}
              className="ml-auto max-w-[85%] whitespace-pre-wrap rounded-btn bg-hover px-3 py-2 text-sm"
            >
              {turn.text}
            </p>
          ) : (
            <AssistantTurn
              key={i}
              turn={turn}
              onOpenListing={onOpenListing}
              onRetry={() => retry(i)}
            />
          ),
        )}

        {busy && <ActivityTrail steps={steps} />}
      </div>

      {/* Only rendered while the user is reading further up — see `pinned`. */}
      {!pinned && (
        <div className="pointer-events-none relative">
          <button
            type="button"
            onClick={jumpToLatest}
            className="animate-pop-in pointer-events-auto absolute -top-11 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-line bg-elevated px-3 py-1.5 text-xs font-medium text-fg shadow-pop transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/70"
          >
            <ArrowDown className="h-3 w-3" aria-hidden />
            Jump to latest
          </button>
        </div>
      )}

      <footer className="border-t border-line px-4 py-3">
        {full ? (
          <div className="space-y-2">
            <p className="text-sm text-fg-muted">
              This chat has reached its message limit. The exchange is kept in
              the activity log.
            </p>
            <Button onClick={newChat} className="w-full">
              Start a new chat
            </Button>
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send(text);
            }}
            className="flex items-end gap-2"
          >
            {/*
              A textarea, not an input: sourcing questions are routinely two
              clauses ("something for floor coatings that isn't an epoxy"), and
              a 40px single-line field turns those into a horizontal scroll.
              Enter sends, Shift+Enter breaks — the convention every chat
              surface the user already knows follows.
            */}
            <AutoTextarea
              textareaRef={inputRef}
              value={text}
              onChange={setText}
              onSubmit={() => void send(text)}
              disabled={busy}
              placeholder="Ask about a chemical, a supplier, or a substitute…"
            />
            {busy ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => abortRef.current?.abort()}
                title="Stop generating"
                className="shrink-0"
              >
                <Square className="h-3.5 w-3.5 fill-current" aria-hidden />
                <span className="sr-only">Stop</span>
              </Button>
            ) : (
              <Button
                type="submit"
                disabled={!text.trim()}
                title="Send (Enter)"
                className="shrink-0"
              >
                <Send className="h-4 w-4" aria-hidden />
                <span className="sr-only">Send</span>
              </Button>
            )}
          </form>
        )}
        {remaining != null && remaining <= 4 && !full && (
          <p className="mt-2 text-xs text-fg-muted">
            {remaining} message{remaining === 1 ? "" : "s"} left in this chat.
          </p>
        )}
      </footer>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Composer                                                            */
/* ------------------------------------------------------------------ */

/**
 * Textarea that grows with its content up to a ceiling, then scrolls. Keeps
 * the composer one line tall at rest (the panel is narrow; every row it takes
 * is a row of transcript lost) without truncating a long question.
 */
function AutoTextarea({
  textareaRef: ref,
  value,
  onChange,
  onSubmit,
  disabled,
  placeholder,
}: {
  // Named `textareaRef`, not `ref`: React 18 has no ref-as-prop, and
  // forwardRef would buy nothing here — the parent owns the element only to
  // focus it.
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    // ~5 rows. Past that the composer would eat the conversation.
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
  }, [value, ref]);

  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      disabled={disabled}
      placeholder={placeholder}
      aria-label="Message the sourcing assistant"
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        // IME composition must never be interrupted by a send.
        if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
          e.preventDefault();
          onSubmit();
        }
      }}
      className="flex max-h-[132px] min-h-10 w-full resize-none rounded-btn border border-line bg-surface px-3 py-2 text-sm text-fg shadow-sm transition-[border-color,box-shadow] duration-150 placeholder:text-fg-subtle focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30 disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-60"
    />
  );
}

/* ------------------------------------------------------------------ */
/* Turns                                                               */
/* ------------------------------------------------------------------ */

function AssistantTurn({
  turn,
  onOpenListing,
  onRetry,
}: {
  turn: Turn;
  onOpenListing: (id: string) => void;
  onRetry: () => void;
}) {
  const failed = turn.status === "error";
  const stopped = turn.status === "stopped";

  return (
    <div className="group/turn space-y-2">
      {failed || stopped ? (
        <div
          className={`flex items-start gap-2 rounded-btn border px-3 py-2 text-sm ${
            failed
              ? "border-danger-text/20 bg-danger-soft text-danger-text"
              : "border-line bg-muted text-fg-muted"
          }`}
        >
          {failed && (
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          )}
          <div className="min-w-0 flex-1">
            <p>{turn.text}</p>
            <button
              type="button"
              onClick={onRetry}
              className="mt-1 font-medium underline underline-offset-2 hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/70"
            >
              Try again
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* Announced to screen readers when it lands; the trail above is a
              separate polite region for progress. */}
          <p
            className="max-w-[95%] whitespace-pre-wrap text-sm leading-relaxed"
            aria-live="polite"
          >
            {turn.text}
          </p>
          {turn.listings?.map((l) => (
            <CitedListing
              key={l.id}
              listing={l}
              onOpen={() => onOpenListing(l.id)}
            />
          ))}
        </>
      )}

      {turn.steps && turn.steps.length > 0 && (
        <TrailSummary steps={turn.steps} />
      )}

      {!failed && !stopped && turn.text && <CopyAnswer text={turn.text} />}
    </div>
  );
}

/**
 * The completed activity trail, collapsed.
 *
 * Kept rather than discarded: it is the evidence of what was actually
 * searched, and the moment a user doubts an answer is exactly the moment they
 * want it back. Collapsed by default because the answer is the point — this is
 * for auditing, not reading.
 */
function TrailSummary({ steps }: { steps: Step[] }) {
  const [open, setOpen] = useState(false);
  const lookups = steps.filter((s) => s.kind === "tool").length;

  return (
    <div className="text-xs">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="inline-flex items-center gap-1 rounded-chip py-0.5 text-fg-subtle transition-colors hover:text-fg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/70"
      >
        <ChevronRight
          className={`h-3 w-3 transition-transform duration-150 ${open ? "rotate-90" : ""}`}
          aria-hidden
        />
        {lookups} lookup{lookups === 1 ? "" : "s"}
      </button>
      {open && (
        <div className="animate-fade-in mt-1.5 space-y-1 border-l border-line pl-3">
          {steps.map((step) => (
            <div
              key={step.key}
              className="flex items-center gap-2 text-fg-subtle"
            >
              <step.icon className="h-3 w-3 shrink-0" aria-hidden />
              <span className="truncate">{step.label}</span>
              {step.result && (
                <span className="shrink-0 tabular-nums">— {step.result}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Copy the answer text. Keyboard-reachable always; visually quiet until hover. */
function CopyAnswer({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error("Could not copy to the clipboard.");
    }
  }

  return (
    <button
      type="button"
      onClick={() => void copy()}
      className="inline-flex items-center gap-1 rounded-chip py-0.5 text-xs text-fg-subtle opacity-0 transition-opacity duration-150 hover:text-fg-muted focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/70 group-hover/turn:opacity-100"
    >
      {copied ? (
        <>
          <ClipboardCheck className="h-3 w-3" aria-hidden />
          Copied
        </>
      ) : (
        <>
          <Copy className="h-3 w-3" aria-hidden />
          Copy
        </>
      )}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Empty state                                                         */
/* ------------------------------------------------------------------ */

/**
 * Teaches the interface rather than filling space: what it searches, what it
 * will not claim, and three questions that exercise genuinely different paths
 * (supplier lookup, application search, substitution). The limits are stated
 * up front because discovering them mid-answer reads as the tool failing.
 */
function EmptyState({ onPick }: { onPick: (s: string) => void }) {
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <p className="text-sm text-fg">
          Ask what we can source, who supplies it, or what could replace it.
        </p>
        <p className="text-xs text-fg-muted">
          Answers come from the brochure catalog and our own recorded notes. It
          won&apos;t quote a price no brochure printed, or confirm regulatory
          status we haven&apos;t recorded.
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onPick(s)}
            className="group flex items-center gap-2 rounded-btn border border-line px-3 py-2 text-left text-sm text-fg-muted transition-colors duration-150 hover:border-brand/40 hover:bg-brand-soft hover:text-brand-soft-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/70"
          >
            <span className="min-w-0 flex-1">{s}</span>
            <ChevronRight
              className="h-3.5 w-3.5 shrink-0 opacity-0 transition-opacity duration-150 group-hover:opacity-100"
              aria-hidden
            />
          </button>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Activity trail (live)                                               */
/* ------------------------------------------------------------------ */

/**
 * The assistant's live activity trail.
 *
 * Every line is a real event from the agent loop, which is the point: a
 * generic spinner for 30 seconds is indistinguishable from a hung request,
 * whereas "Searching the catalog for 'epoxy hardener' → 12 results" tells the
 * user the system is alive AND what it understood them to mean — so a
 * misread question is obvious before the answer arrives.
 *
 * Completed steps stay on screen and dim; only the current one animates.
 * Motion is decorative here — every state is legible from its text and icon
 * alone, which is what makes the global reduced-motion reset safe.
 */
function ActivityTrail({ steps }: { steps: Step[] }) {
  return (
    <div className="space-y-1.5" role="status" aria-live="polite">
      {steps.length === 0 && <WorkingLine label="Thinking" icon={Sparkles} />}
      {steps.map((step) =>
        step.done ? (
          <div
            key={step.key}
            className="flex items-center gap-2 text-xs text-fg-subtle animate-fade-in"
          >
            <Check className="h-3 w-3 shrink-0" aria-hidden />
            <span className="truncate">{step.label}</span>
            {step.result && (
              <span className="shrink-0 tabular-nums">— {step.result}</span>
            )}
          </div>
        ) : (
          <WorkingLine key={step.key} label={step.label} icon={step.icon} />
        ),
      )}
    </div>
  );
}

/** The one step currently in flight: pulsing icon, animated dots, shimmer. */
function WorkingLine({
  label,
  icon: Icon,
}: {
  label: string;
  icon: typeof Search;
}) {
  return (
    <div className="animate-fade-in space-y-1.5">
      <div className="flex items-center gap-2 text-xs text-fg-muted">
        <span className="relative flex h-3 w-3 shrink-0 items-center justify-center">
          {/* Expanding ring behind the icon — reads as "live" at a glance
              without competing with the label for attention. */}
          <span className="absolute inline-flex h-3 w-3 rounded-full bg-brand/30 animate-pulse-ring" />
          <Icon className="relative h-3 w-3 text-brand" aria-hidden />
        </span>
        <span className="truncate">{label}</span>
        <span className="flex shrink-0 gap-0.5" aria-hidden>
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="h-1 w-1 rounded-full bg-current animate-thinking-dot"
              style={{ animationDelay: `${i * 160}ms` }}
            />
          ))}
        </span>
      </div>
      {/* Indeterminate sweep. Deliberately not a percentage bar: the agent
          loop has no known number of steps, so a filling bar would promise
          progress information that does not exist. */}
      <div className="relative h-0.5 overflow-hidden rounded-full bg-hover">
        <div className="absolute inset-y-0 -left-1/3 w-1/3 rounded-full bg-brand/60 animate-shimmer" />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Cited listing                                                       */
/* ------------------------------------------------------------------ */

/**
 * A product the assistant cited, rendered from the database row. Price shows
 * only when the brochure actually printed one — most don't, and an em dash is
 * honest where a placeholder price would not be.
 *
 * The review flag renders as the same warning Badge the results table uses —
 * a status that reads one way here and another way there is two vocabularies
 * for one fact. It is the bare Badge rather than ResultsTable's ReviewBadge
 * because that one wraps a <button> for its tooltip, and this whole row is
 * already a button; nesting them is invalid HTML and breaks click handling.
 */
function CitedListing({
  listing,
  onOpen,
}: {
  listing: Listing;
  onOpen: () => void;
}) {
  const supplier =
    listing.company_name_en || listing.company_name || "Unknown supplier";
  return (
    <button
      type="button"
      onClick={onOpen}
      title={`Open ${listing.name_en}`}
      className="block w-full rounded-btn border border-line bg-surface px-3 py-2 text-left transition-colors duration-150 hover:border-brand/40 hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/70"
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="truncate text-sm font-medium">{listing.name_en}</span>
        <span className="shrink-0 text-sm tabular-nums">
          {listing.price != null
            ? formatPrice(listing.price, listing.currency)
            : "—"}
        </span>
      </div>
      <div className="mt-0.5 flex items-baseline justify-between gap-3 text-xs text-fg-muted">
        <span className="truncate">{supplier}</span>
        {listing.purity && (
          <span className="shrink-0 tabular-nums">{listing.purity}</span>
        )}
      </div>
      {listing.needs_review && (
        <span className="mt-1 inline-flex">
          <Badge variant="warning">review</Badge>
        </span>
      )}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** The Inspector state, as chips the user can actually verify. */
function describeContext(
  context: InspectorContext,
): { kind: string; label: string }[] {
  const chips: { kind: string; label: string }[] = [];
  // Selected row first: it is what pronouns bind to, so it matters most.
  if (context.selected_listing_name) {
    chips.push({ kind: "Selected product", label: context.selected_listing_name });
  }
  if (context.query) chips.push({ kind: "Search", label: `“${context.query}”` });
  if (context.supplier) chips.push({ kind: "Supplier", label: context.supplier });
  if (context.cas_number) chips.push({ kind: "CAS", label: context.cas_number });
  return chips;
}

/**
 * Fold one progress event into the activity trail.
 *
 * A `tool` event opens a step; the matching `tool_done` closes it and records
 * what came back, so the user sees a real trail ("searched X → 12 products")
 * rather than a spinner that could equally mean the request died.
 *
 * Pure, and returns a new array — the caller keeps the running value in a
 * local so the finished trail can be attached to the turn.
 */
function reduceEvent(steps: Step[], event: ChatEvent): Step[] {
  if (event.type === "thinking") {
    // Only one open thinking step at a time; a second model call after tools
    // have run replaces it rather than stacking.
    if (steps.some((s) => !s.done && s.key.startsWith("think"))) return steps;
    return [
      ...steps,
      {
        key: `think-${steps.length}`,
        kind: "think",
        icon: Sparkles,
        label: "Thinking",
        done: false,
      },
    ];
  }

  if (event.type === "tool") {
    const meta = TOOL_META[event.name] ?? { icon: Search, verb: "Looking up" };
    return [
      // Close any open thinking step — the model has decided what to do.
      ...steps.map((s) => (s.done ? s : { ...s, done: true })),
      {
        key: `${event.name}-${steps.length}`,
        kind: "tool",
        icon: meta.icon,
        label: event.detail ? `${meta.verb} for “${event.detail}”` : meta.verb,
        done: false,
      },
    ];
  }

  if (event.type === "tool_done") {
    const next = [...steps];
    for (let i = next.length - 1; i >= 0; i--) {
      if (!next[i].done) {
        next[i] = {
          ...next[i],
          done: true,
          // A failed lookup must not read as an empty catalog — that
          // ambiguity once hid a real bug.
          result: event.duplicate
            ? "already searched"
            : event.failed
              ? "lookup failed"
              : event.count > 0
                ? `${event.count} result${event.count === 1 ? "" : "s"}`
                : "nothing found",
        };
        break;
      }
    }
    return next;
  }

  return steps;
}

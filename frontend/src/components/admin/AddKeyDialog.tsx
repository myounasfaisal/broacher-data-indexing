import { useState } from "react";
import { Check, Loader2, X } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { PROVIDERS } from "@/lib/settingsLayout";
import { checkKeyFormat, KEY_SHAPES, suggestFix } from "@/lib/keySuggestions";

/**
 * "Add an AI key" — a self-contained onboarding flow for a non-technical
 * admin: pick which AI service, paste its key (and endpoint, if it needs
 * one), test it, save it. The heavy machinery (which section uses which
 * provider, how to test a key) is the same PROVIDERS table the main settings
 * sections use — this is a friendlier front door onto it, not a second
 * system, so a key added here shows up wherever that provider is already
 * wired in (Extraction, Chat, ...).
 */
export function AddKeyDialog({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const providerIds = Object.keys(PROVIDERS);
  const [providerId, setProviderId] = useState(providerIds[0]);
  const [key, setKey] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [formatWarning, setFormatWarning] = useState<string | null>(null);
  const [test, setTest] = useState<
    { ok: boolean; message: string; hint?: string | null } | "pending" | undefined
  >(undefined);
  const [saving, setSaving] = useState(false);

  const provider = PROVIDERS[providerId];

  function reset() {
    setKey("");
    setEndpoint("");
    setFormatWarning(null);
    setTest(undefined);
    setSaving(false);
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function runTest() {
    const problem = checkKeyFormat(providerId, key);
    if (problem) {
      setFormatWarning(problem);
      setTest(undefined);
      return;
    }
    setFormatWarning(null);
    setTest("pending");
    try {
      const result = await api.testApiKey(provider.testAs, key, endpoint);
      setTest({ ...result, hint: result.ok ? null : suggestFix(result.message) });
    } catch (err) {
      setTest({
        ok: false,
        message: err instanceof Error ? err.message : "Test failed",
      });
    }
  }

  async function save() {
    setSaving(true);
    try {
      const changes: Record<string, string> = { [provider.keyKey]: key };
      if (provider.baseKey && endpoint) changes[provider.baseKey] = endpoint;
      await api.updateSettings(changes);
      onSaved();
      handleClose();
    } catch {
      setSaving(false);
    }
  }

  const shape = KEY_SHAPES[providerId];
  const canSave = test !== undefined && test !== "pending" && test.ok;

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Add an AI key"
      description="Pick a service, paste its key, and test it before saving."
      footer={
        <>
          <Button variant="ghost" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            variant="outline"
            onClick={runTest}
            disabled={!key || test === "pending"}
          >
            {test === "pending" ? (
              <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />
            ) : (
              <Check className="h-4 w-4" aria-hidden />
            )}
            Test
          </Button>
          <Button onClick={save} disabled={!canSave || saving}>
            {saving && (
              <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />
            )}
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <Label htmlFor="add-key-provider">Which service</Label>
          <Select
            id="add-key-provider"
            className="mt-1.5"
            value={providerId}
            onChange={(e) => {
              setProviderId(e.target.value);
              reset();
            }}
          >
            {providerIds.map((id) => (
              <option key={id} value={id}>
                {PROVIDERS[id].label}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <Label htmlFor="add-key-value">API key</Label>
          <Input
            id="add-key-value"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={key}
            onChange={(e) => {
              setKey(e.target.value);
              setFormatWarning(null);
              setTest(undefined);
            }}
            placeholder={shape?.example ?? "Paste the key here"}
            className="mt-1.5 font-mono text-[13px]"
          />
          <p className="mt-1.5 text-xs text-fg-subtle">
            Get one from{" "}
            <a
              href={provider.console.href}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2 hover:text-fg"
            >
              {provider.console.label}
            </a>
            .
          </p>
        </div>

        {provider.baseKey && (
          <div>
            <Label htmlFor="add-key-endpoint">Endpoint (optional)</Label>
            <Input
              id="add-key-endpoint"
              value={endpoint}
              onChange={(e) => {
                setEndpoint(e.target.value);
                setTest(undefined);
              }}
              placeholder="Leave blank to use the default address"
              className="mt-1.5 font-mono text-[13px]"
            />
          </div>
        )}

        {formatWarning && (
          <p role="alert" className="flex items-start gap-1.5 text-xs text-danger-text">
            <X className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
            {formatWarning}
          </p>
        )}

        {test && test !== "pending" && (
          <div
            role="status"
            className={
              "flex flex-col gap-1 text-xs " +
              (test.ok ? "text-ok-text" : "text-danger-text")
            }
          >
            <span className="flex items-start gap-1.5">
              {test.ok ? (
                <Check className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
              ) : (
                <X className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
              )}
              {test.message}
            </span>
            {test.hint && <span className="pl-5 text-fg-muted">{test.hint}</span>}
          </div>
        )}

        {!test && (
          <p className="text-xs text-fg-subtle">
            Test the key before saving — that way you know it works before you
            rely on it.
          </p>
        )}
      </div>
    </Modal>
  );
}

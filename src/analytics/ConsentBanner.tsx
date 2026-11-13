// The analytics consent prompt (ADR 0008). It asks once, with two equally
// weighted answers, and afterwards leaves only a quiet "Analytics settings"
// button so the choice can be changed (withdrawing is as easy as giving).
// The choice itself lives in the BFF's cookie (`useConsent`); this component
// shows nothing when analytics is off in `/bff/config`, when the browser
// sends Global Privacy Control / Do Not Track (the BFF drops those events
// anyway) or until the first read of the stored choice has settled.
import { useEffect, useRef, useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useRuntimeConfig } from "../auth/config";
import { hasAnswered, markAnswered, useConsent } from "./consent";
import { browserOptedOut } from "./track";

function analyticsEnabled(config: Record<string, unknown>): boolean {
  const analytics = config.analytics;
  return (
    typeof analytics === "object" &&
    analytics !== null &&
    (analytics as { enabled?: unknown }).enabled === true
  );
}

// Both answers share one look: an ink outline, no accent on either.
const answerSx = {
  borderColor: "text.primary",
  color: "text.primary",
} as const;

export function ConsentBanner() {
  const config = useRuntimeConfig();
  const { granted, ready, choose } = useConsent();
  const [answered, setAnswered] = useState(() => hasAnswered());
  // `true` once the visitor reopened the prompt from the settings button.
  const [reopened, setReopened] = useState(false);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  // Which element receives focus after the next render (a prompt that appears
  // or disappears must not strand keyboard focus on a removed button).
  const focusNext = useRef<"prompt" | "settings" | null>(null);
  const promptRef = useRef<HTMLHeadingElement>(null);
  const settingsRef = useRef<HTMLButtonElement>(null);

  // After every render: move focus once if a handler asked for it.
  useEffect(() => {
    const target = focusNext.current;
    focusNext.current = null;
    if (target === "prompt") promptRef.current?.focus();
    if (target === "settings") settingsRef.current?.focus();
  });

  if (!analyticsEnabled(config) || browserOptedOut() || !ready) return null;

  const asking = reopened || (!answered && granted !== true);

  async function answer(analytics: boolean) {
    setSaving(true);
    setFailed(false);
    const stored = await choose(analytics);
    setSaving(false);
    if (stored === null) {
      // The cookie still holds the previous choice; say so, keep the prompt.
      setFailed(true);
      return;
    }
    markAnswered();
    setAnswered(true);
    setReopened(false);
    focusNext.current = "settings";
  }

  if (!asking) {
    return (
      <Box component="footer" sx={{ px: 3, py: 1 }}>
        <Button
          ref={settingsRef}
          size="small"
          color="inherit"
          onClick={() => {
            setReopened(true);
            focusNext.current = "prompt";
          }}
        >
          Analytics settings
        </Button>
      </Box>
    );
  }

  return (
    <Box
      component="section"
      aria-labelledby="consent-title"
      aria-describedby="consent-body"
      sx={{
        position: "sticky",
        bottom: 0,
        zIndex: "appBar",
        bgcolor: "background.paper",
        borderTop: 2,
        borderStyle: "solid",
        borderColor: "text.primary",
        px: 3,
        py: 2,
      }}
    >
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={{ xs: 2, sm: 4 }}
        sx={{ alignItems: { sm: "center" }, justifyContent: "space-between" }}
      >
        <Box sx={{ maxWidth: "60ch" }}>
          <Typography
            id="consent-title"
            ref={promptRef}
            tabIndex={-1}
            variant="subtitle1"
            component="h2"
          >
            Count my visits?
          </Typography>
          <Typography id="consent-body" variant="body2" color="text.secondary">
            We count which pages are used, to improve them. No tracking cookies,
            no ids kept in your browser, and your address is never passed on. A
            Global Privacy Control signal is always respected.
            {reopened && granted !== null
              ? ` Currently: ${granted ? "allowed" : "declined"}.`
              : ""}
          </Typography>
          {failed ? (
            <Typography role="alert" variant="body2" color="error">
              Could not save your choice. Nothing changed; try again.
            </Typography>
          ) : null}
        </Box>
        <Stack direction="row" spacing={2} sx={{ flexShrink: 0 }}>
          <Button
            variant="outlined"
            sx={answerSx}
            disabled={saving}
            onClick={() => void answer(true)}
          >
            Allow
          </Button>
          <Button
            variant="outlined"
            sx={answerSx}
            disabled={saving}
            onClick={() => void answer(false)}
          >
            Decline
          </Button>
        </Stack>
      </Stack>
    </Box>
  );
}

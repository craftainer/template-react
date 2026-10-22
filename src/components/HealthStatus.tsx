// AppBar indicator: polls the backend's public liveness probe so a broken
// connection (wrong VITE_API_BASE_URL, backend down) is visible immediately
// instead of surfacing only once someone opens the Heroes page.
import { useEffect, useState } from "react";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import { checkLive } from "../api/health";

const POLL_INTERVAL_MS = 30_000;

// Visually hidden, still in the accessibility tree.
const srOnly = {
  position: "absolute",
  width: "0.0625rem",
  height: "0.0625rem",
  margin: "-0.0625rem",
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
} as const;

type Status = "checking" | "up" | "down";

export function HealthStatus() {
  const [status, setStatus] = useState<Status>("checking");

  useEffect(() => {
    let cancelled = false;

    const poll = () => {
      checkLive()
        .then(() => {
          if (!cancelled) setStatus("up");
        })
        .catch(() => {
          if (!cancelled) setStatus("down");
        });
    };

    poll();
    const id = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // "Backend" is always read by screen readers but only shown from the sm
  // breakpoint up, so the app bar stays on one line on a phone.
  const detail =
    status === "checking"
      ? "checking…"
      : status === "up"
        ? "up"
        : "unreachable";
  const label = (
    <>
      <Box
        component="span"
        sx={(theme) => ({
          [theme.breakpoints.down("sm")]: srOnly,
        })}
      >
        Backend{" "}
      </Box>
      {detail}
    </>
  );
  const color =
    status === "up" ? "success" : status === "down" ? "error" : "default";

  return <Chip size="small" label={label} color={color} variant="outlined" />;
}

// AppBar indicator: polls the backend's public liveness probe so a broken
// connection (wrong VITE_API_BASE_URL, backend down) is visible immediately
// instead of surfacing only once someone opens the Heroes page.
import { useEffect, useState } from "react";
import Chip from "@mui/material/Chip";
import { checkLive } from "../api/health";

const POLL_INTERVAL_MS = 30_000;

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

  const label =
    status === "checking"
      ? "Checking backend…"
      : status === "up"
        ? "Backend up"
        : "Backend unreachable";
  const color =
    status === "up" ? "success" : status === "down" ? "error" : "default";

  return <Chip size="small" label={label} color={color} variant="outlined" />;
}

// Worked-example page for the backend's own worked-example resource (Hero) --
// list/create/delete against /crud/v1/heroes/v2/json, gated on the "viewer"/
// "editor"/"maintainer" client roles the backend's realm-export.json assigns
// to its test users (see .devcontainer/stack/keycloak's README in the
// backend repo).
import { useCallback, useEffect, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import DeleteIcon from "@mui/icons-material/Delete";
import { useAuth } from "react-oidc-context";
import { ApiError } from "../api/client";
import { heroesCrud, type Hero } from "../api/heroes";

export function HeroesPage() {
  const auth = useAuth();
  const accessToken = auth.user?.access_token;

  const [heroes, setHeroes] = useState<Hero[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [powers, setPowers] = useState("");

  // Fetches without touching `loading` -- callers that want a spinner (the
  // initial load, a manual refresh after create/delete) set it themselves
  // first; the effect below intentionally doesn't, since `loading` already
  // starts `true`.
  const fetchHeroes = useCallback(() => {
    if (!accessToken) return;
    heroesCrud
      .list(accessToken)
      .then((result) => {
        setHeroes(result);
        setError(null);
      })
      .catch((err: unknown) => setError(describeError(err)))
      .finally(() => setLoading(false));
  }, [accessToken]);

  useEffect(() => {
    fetchHeroes();
  }, [fetchHeroes]);

  const refresh = () => {
    setLoading(true);
    fetchHeroes();
  };

  const handleCreate = async () => {
    if (!accessToken) return;
    try {
      await heroesCrud.create(accessToken, {
        name,
        powers: powers
          .split(",")
          .map((p) => p.trim())
          .filter(Boolean),
      });
      setDialogOpen(false);
      setName("");
      setPowers("");
      refresh();
    } catch (err) {
      setError(describeError(err));
    }
  };

  const handleDelete = async (id: number) => {
    if (!accessToken) return;
    try {
      await heroesCrud.remove(accessToken, id);
      refresh();
    } catch (err) {
      setError(describeError(err));
    }
  };

  return (
    <Stack spacing={2}>
      <Stack
        direction="row"
        sx={{ justifyContent: "space-between", alignItems: "center" }}
      >
        <Typography variant="h5">Heroes</Typography>
        <Button variant="contained" onClick={() => setDialogOpen(true)}>
          Add hero
        </Button>
      </Stack>

      {error && <Alert severity="error">{error}</Alert>}

      {loading ? (
        <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
          <CircularProgress />
        </Box>
      ) : (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Name</TableCell>
                <TableCell>Powers</TableCell>
                <TableCell align="right">Power level</TableCell>
                <TableCell align="right"></TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {heroes.map((hero) => (
                <TableRow key={hero.id}>
                  <TableCell>{hero.name ?? <em>(draft)</em>}</TableCell>
                  <TableCell>
                    <Stack
                      direction="row"
                      spacing={0.5}
                      sx={{ flexWrap: "wrap" }}
                    >
                      {(hero.powers ?? []).map((power) => (
                        <Chip key={power} label={power} size="small" />
                      ))}
                    </Stack>
                  </TableCell>
                  <TableCell align="right">{hero.power_level ?? "—"}</TableCell>
                  <TableCell align="right">
                    <IconButton
                      size="small"
                      onClick={() => handleDelete(hero.id)}
                      aria-label={`Delete ${hero.name}`}
                    >
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))}
              {heroes.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} align="center">
                    No heroes yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>Add hero</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              fullWidth
            />
            <TextField
              label="Powers (comma-separated)"
              value={powers}
              onChange={(e) => setPowers(e.target.value)}
              fullWidth
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button
            onClick={handleCreate}
            variant="contained"
            disabled={!name || !powers}
          >
            Create
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}

function describeError(err: unknown): string {
  if (err instanceof ApiError) {
    const detail = err.detail as { detail?: string; title?: string } | null;
    return detail?.detail ?? detail?.title ?? `Request failed (${err.status})`;
  }
  return err instanceof Error ? err.message : "Unknown error";
}

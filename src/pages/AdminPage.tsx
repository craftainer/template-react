// Manifest-driven admin: every resource the signed-in caller's manifest lists
// gets a records table, a form, a detail page and -- only where the manifest's
// capabilities allow it -- statistics, predictions, revisions and a trash.
// Nothing here knows the Hero model; see docs/adrs/0006-manifest-driven-admin.md.
import { useEffect, useMemo, useRef, useState } from "react";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import AddIcon from "@mui/icons-material/Add";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import {
  DeleteAction,
  PageShell,
  PredictionsDashboard,
  RecordDetail,
  RecordRevisions,
  ResourceForm,
  ResourceGate,
  ResourceList,
  StatsDashboard,
  SYSTEM_FIELDS,
  TrashList,
  type ReadyResource,
  type UrlAdapter,
} from "@craftainer/crud-views";
import { useAuth } from "react-oidc-context";
import { CrudApiProvider } from "../api/CrudApi";
import { useCrudApi } from "../api/crudApiContext";
import { mayDo, rolesFromToken } from "../api/roles";
import { etagGetter, latestResources, rowEtagGetter } from "../api/sdk";
import { useUrlParams } from "./useUrlParams";

/** The signed-in caller's roles from the access token, `null` when unreadable. */
function useCallerRoles() {
  const auth = useAuth();
  // `settings` is the OIDC client's configuration (its `client_id` names the
  // client whose roles count); a stubbed session has none.
  const clientId = (auth.settings as { client_id?: string } | undefined)
    ?.client_id;
  return rolesFromToken(auth.user?.access_token, clientId ?? "");
}

/**
 * Opening a record on a click and editing a cell on a double click share the
 * same gesture, so the open waits a moment and a double click or an edit in
 * progress cancels it.
 */
const OPEN_DELAY_MS = 300;

function useOpenOnClick(open: (id: string) => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Clicks are ignored until then: forever while a cell is being edited, and
  // for a moment after the edit ends, because the click that leaves an edit
  // arrives after the editor has already stopped.
  const ignoreUntil = useRef(0);
  const cancel = () => clearTimeout(timer.current);
  useEffect(() => cancel, []);
  return {
    click(id: string) {
      cancel();
      if (Date.now() < ignoreUntil.current) return;
      timer.current = setTimeout(() => open(id), OPEN_DELAY_MS);
    },
    gridProps: {
      onCellDoubleClick: cancel,
      onCellEditStart: () => {
        ignoreUntil.current = Number.POSITIVE_INFINITY;
        cancel();
      },
      onCellEditStop: () => {
        ignoreUntil.current = Date.now() + OPEN_DELAY_MS;
      },
    },
  };
}

type View = "records" | "stats" | "predictions" | "trash";

const VIEW_LABELS: Record<View, string> = {
  records: "Records",
  stats: "Statistics",
  predictions: "Predictions",
  trash: "Trash",
};

/** The views this resource's capabilities allow, in tab order. */
function availableViews(ready: ReadyResource): View[] {
  const { capabilities } = ready;
  return [
    "records",
    ...(capabilities.stats ? (["stats"] as const) : []),
    ...(capabilities.predict ? (["predictions"] as const) : []),
    ...(capabilities.archive_restore ? (["trash"] as const) : []),
  ];
}

const tabId = (view: View) => `admin-tab-${view}`;
const panelId = (view: View) => `admin-panel-${view}`;

interface AdminProps {
  readonly urlAdapter?: UrlAdapter | undefined;
}

/** The admin; signs the SDK client in with the OIDC session first. */
export function AdminPage({ urlAdapter }: AdminProps) {
  const auth = useAuth();
  return (
    // A new identity gets a new client, cache and manifest.
    <CrudApiProvider key={auth.user?.profile.sub}>
      <Admin urlAdapter={urlAdapter} />
    </CrudApiProvider>
  );
}

function Admin({ urlAdapter }: AdminProps) {
  const { manifest } = useCrudApi();
  const resources = useMemo(() => latestResources(manifest), [manifest]);
  const { params, update } = useUrlParams(urlAdapter);

  if (resources.length === 0) {
    return (
      <Alert severity="info">
        Your account can see no resources. Ask for the viewer role.
      </Alert>
    );
  }

  const requested = params.get("resource");
  const current =
    resources.find((r) => r.name === requested)?.name ?? resources[0].name;

  return (
    <Stack spacing={2}>
      {resources.length > 1 && (
        <Tabs
          value={current}
          onChange={(_event, name: string) =>
            update({ resource: name, id: null, view: null })
          }
          aria-label="Resources"
        >
          {resources.map((r) => (
            <Tab key={r.name} value={r.name} label={r.title} />
          ))}
        </Tabs>
      )}
      <ResourceGate name={current}>
        {(ready) => (
          <ResourceAdmin
            key={ready.resource.name}
            ready={ready}
            urlAdapter={urlAdapter}
          />
        )}
      </ResourceGate>
    </Stack>
  );
}

function ResourceAdmin({
  ready,
  urlAdapter,
}: {
  readonly ready: ReadyResource;
  readonly urlAdapter?: UrlAdapter | undefined;
}) {
  const { params, update } = useUrlParams(urlAdapter);
  const idParam = params.get("id");
  const id = idParam !== null && /^\d+$/.test(idParam) ? Number(idParam) : null;

  return id === null ? (
    <ResourceOverview ready={ready} urlAdapter={urlAdapter} />
  ) : (
    <RecordPage ready={ready} id={id} onBack={() => update({ id: null })} />
  );
}

function ResourceOverview({
  ready,
  urlAdapter,
}: {
  readonly ready: ReadyResource;
  readonly urlAdapter?: UrlAdapter | undefined;
}) {
  const { params, update } = useUrlParams(urlAdapter);
  const [creating, setCreating] = useState(false);
  const roles = useCallerRoles();
  const api = useCrudApi();
  const rowEtag = useMemo(
    () => rowEtagGetter(api, ready.resource),
    [api, ready],
  );
  const opening = useOpenOnClick((id) => update({ id }));
  const views = availableViews(ready);
  const requested = params.get("view") as View | null;
  const view = requested && views.includes(requested) ? requested : "records";
  const { name } = ready.resource;

  // The system fields (ids, owner, lifecycle and audit timestamps) live on the
  // detail page; JSON fields do not fit a cell.
  const columns = ready.fields
    .filter((f) => !SYSTEM_FIELDS.includes(f.name) && f.kind !== "json")
    .map((f) => f.name);

  return (
    <PageShell
      title={ready.resource.title}
      maxWidth={false}
      actions={
        mayDo(roles, ready.resource.auth.write_roles) ? (
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => setCreating(true)}
          >
            Add record
          </Button>
        ) : undefined
      }
    >
      <Stack spacing={2}>
        {views.length > 1 && (
          <Tabs
            value={view}
            onChange={(_event, next: View) =>
              update({ view: next === "records" ? null : next })
            }
            aria-label={`${ready.resource.title} views`}
          >
            {views.map((v) => (
              <Tab
                key={v}
                value={v}
                label={VIEW_LABELS[v]}
                id={tabId(v)}
                aria-controls={panelId(v)}
              />
            ))}
          </Tabs>
        )}
        <Box
          {...(views.length > 1
            ? {
                role: "tabpanel",
                id: panelId(view),
                "aria-labelledby": tabId(view),
              }
            : {})}
        >
          {view === "records" && (
            <ResourceList
              resource={name}
              variant="table"
              filters={["quick"]}
              columns={columns}
              editable={mayDo(roles, ready.resource.auth.write_roles)}
              ifMatch={rowEtag}
              urlAdapter={urlAdapter}
              prefix={`${name}_`}
              onRowClick={(row) => opening.click(String(row.id))}
              gridProps={opening.gridProps}
            />
          )}
          {view === "stats" && <StatsDashboard resource={name} />}
          {view === "predictions" && <PredictionsDashboard resource={name} />}
          {view === "trash" && <TrashList resource={name} />}
        </Box>
      </Stack>
      <ResourceForm
        name={name}
        presentation="dialog"
        open={creating}
        onClose={() => setCreating(false)}
        onSaved={() => setCreating(false)}
        recordLabel="record"
      />
    </PageShell>
  );
}

function RecordPage({
  ready,
  id,
  onBack,
}: {
  readonly ready: ReadyResource;
  readonly id: number;
  readonly onBack: () => void;
}) {
  const api = useCrudApi();
  const { name } = ready.resource;
  const roles = useCallerRoles();
  const etag = useMemo(() => etagGetter(api, ready.resource), [api, ready]);

  return (
    <Stack spacing={2}>
      <Box>
        <Button startIcon={<ArrowBackIcon />} onClick={onBack}>
          Back to {ready.resource.title}
        </Button>
      </Box>
      <RecordDetail
        resource={name}
        id={id}
        variant="form"
        renderForm={({ id: recordId, onDone }) => (
          <ResourceForm
            name={name}
            id={recordId}
            etag={etag}
            recordLabel="record"
            onSaved={onDone}
          />
        )}
      />
      {mayDo(roles, ready.resource.auth.delete_roles) && (
        <Stack direction="row" spacing={1}>
          <DeleteAction
            name={name}
            id={id}
            variant="confirm"
            recordLabel="record"
            onDeleted={onBack}
          />
        </Stack>
      )}
      <RecordRevisions resource={name} id={id} variant="list" />
    </Stack>
  );
}

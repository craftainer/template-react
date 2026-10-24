// A real manifest, captured from template-fastapi's `GET /api/_crud/manifest`
// (heroes v2, as the maintainer sees it), and fixed records, for the admin's
// stories and tests. Dates are fixed so screenshots do not drift.
export const manifestFixture = {
  manifest_version: "1",
  service: {
    name: "template-fastapi",
    version: "0.1.0",
  },
  resources: [
    {
      name: "heroes",
      title: "Heroes",
      api_version: "v2",
      base_path: "/crud/v1/heroes/v2/json",
      formats: {
        json: "/crud/v1/heroes/v2/json",
        xml: "/crud/v1/heroes/v2/xml",
        web: "/crud/v1/heroes/v2/web",
      },
      id_field: "id",
      schemas: {
        read: {
          description:
            "A Hero as returned by the API, including its assigned id, owner, and lifecycle state.\n\n`name`/`powers` are optional here (unlike HeroV2Base/HeroV2Create) since a\ndraft Hero -- see craftainer_crud.models.mixins.Draftable -- may have either or both\nstill unset. `is_draft`/`archived_at`/`publish_at`/`unpublish_at`/`is_locked`\nare every record-lifecycle mixin Hero demonstrates (see craftainer_crud.models.mixins);\nall are read-only here -- `is_draft`/`archived_at` are set exclusively through\ntheir own dedicated actions (`/draft`+`/publish`, `DELETE`+`/restore`), while\n`is_locked`/`publish_at`/`unpublish_at` are set through the normal `PATCH`\nroute instead (see HeroV2Update) -- none are accepted on HeroV2Create.",
          properties: {
            id: {
              title: "Id",
              type: "integer",
            },
            name: {
              anyOf: [
                {
                  maxLength: 200,
                  minLength: 1,
                  type: "string",
                },
                {
                  type: "null",
                },
              ],
              default: null,
              title: "Name",
            },
            powers: {
              anyOf: [
                {
                  items: {
                    maxLength: 200,
                    minLength: 1,
                    type: "string",
                  },
                  minItems: 1,
                  type: "array",
                },
                {
                  type: "null",
                },
              ],
              default: null,
              title: "Powers",
            },
            power_level: {
              anyOf: [
                {
                  type: "integer",
                },
                {
                  type: "null",
                },
              ],
              default: null,
              title: "Power Level",
            },
            owner_id: {
              title: "Owner Id",
              type: "string",
            },
            is_draft: {
              title: "Is Draft",
              type: "boolean",
            },
            archived_at: {
              anyOf: [
                {
                  type: "string",
                },
                {
                  type: "null",
                },
              ],
              title: "Archived At",
            },
            publish_at: {
              anyOf: [
                {
                  type: "string",
                },
                {
                  type: "null",
                },
              ],
              title: "Publish At",
            },
            unpublish_at: {
              anyOf: [
                {
                  type: "string",
                },
                {
                  type: "null",
                },
              ],
              title: "Unpublish At",
            },
            is_locked: {
              title: "Is Locked",
              type: "boolean",
            },
            created_at: {
              title: "Created At",
              type: "string",
            },
            updated_at: {
              title: "Updated At",
              type: "string",
            },
          },
          required: [
            "id",
            "owner_id",
            "is_draft",
            "archived_at",
            "publish_at",
            "unpublish_at",
            "is_locked",
            "created_at",
            "updated_at",
          ],
          title: "HeroV2",
          type: "object",
        },
        create: {
          description: "Fields accepted when creating a Hero.",
          properties: {
            name: {
              maxLength: 200,
              minLength: 1,
              title: "Name",
              type: "string",
            },
            powers: {
              items: {
                maxLength: 200,
                minLength: 1,
                type: "string",
              },
              minItems: 1,
              title: "Powers",
              type: "array",
            },
            power_level: {
              anyOf: [
                {
                  type: "integer",
                },
                {
                  type: "null",
                },
              ],
              default: null,
              title: "Power Level",
            },
          },
          required: ["name", "powers"],
          title: "HeroV2Create",
          type: "object",
        },
        update: {
          description:
            "Fields accepted when partially updating a Hero -- all optional.\n\nAlso the shape a draft create/publish body validates against (see\ncraftainer_crud.controllers.crud_router's `/draft` route and app/README.md's \"Example\nCRUD resource: Hero\") -- a draft is just a record accepted through this same\nall-optional shape, with `id` and every omitted field taking its column\ndefault.\n\n`is_locked`/`publish_at`/`unpublish_at` are the lifecycle fields accepted here\n(unlike `is_draft`/`archived_at`, each set exclusively through its own\ndedicated action) -- see craftainer_crud.models.mixins.Lockable/Schedulable: lock/unlock\nand scheduling both reuse this normal PATCH route rather than getting\ndedicated routes of their own.",
          properties: {
            name: {
              anyOf: [
                {
                  maxLength: 200,
                  minLength: 1,
                  type: "string",
                },
                {
                  type: "null",
                },
              ],
              default: null,
              title: "Name",
            },
            powers: {
              anyOf: [
                {
                  items: {
                    maxLength: 200,
                    minLength: 1,
                    type: "string",
                  },
                  minItems: 1,
                  type: "array",
                },
                {
                  type: "null",
                },
              ],
              default: null,
              title: "Powers",
            },
            power_level: {
              anyOf: [
                {
                  type: "integer",
                },
                {
                  type: "null",
                },
              ],
              default: null,
              title: "Power Level",
            },
            is_locked: {
              anyOf: [
                {
                  type: "boolean",
                },
                {
                  type: "null",
                },
              ],
              default: null,
              title: "Is Locked",
            },
            publish_at: {
              anyOf: [
                {
                  format: "date-time",
                  type: "string",
                },
                {
                  type: "null",
                },
              ],
              default: null,
              title: "Publish At",
            },
            unpublish_at: {
              anyOf: [
                {
                  format: "date-time",
                  type: "string",
                },
                {
                  type: "null",
                },
              ],
              default: null,
              title: "Unpublish At",
            },
          },
          title: "HeroV2Update",
          type: "object",
        },
        draft: {
          description:
            "Fields accepted when partially updating a Hero -- all optional.\n\nAlso the shape a draft create/publish body validates against (see\ncraftainer_crud.controllers.crud_router's `/draft` route and app/README.md's \"Example\nCRUD resource: Hero\") -- a draft is just a record accepted through this same\nall-optional shape, with `id` and every omitted field taking its column\ndefault.\n\n`is_locked`/`publish_at`/`unpublish_at` are the lifecycle fields accepted here\n(unlike `is_draft`/`archived_at`, each set exclusively through its own\ndedicated action) -- see craftainer_crud.models.mixins.Lockable/Schedulable: lock/unlock\nand scheduling both reuse this normal PATCH route rather than getting\ndedicated routes of their own.",
          properties: {
            name: {
              anyOf: [
                {
                  maxLength: 200,
                  minLength: 1,
                  type: "string",
                },
                {
                  type: "null",
                },
              ],
              default: null,
              title: "Name",
            },
            powers: {
              anyOf: [
                {
                  items: {
                    maxLength: 200,
                    minLength: 1,
                    type: "string",
                  },
                  minItems: 1,
                  type: "array",
                },
                {
                  type: "null",
                },
              ],
              default: null,
              title: "Powers",
            },
            power_level: {
              anyOf: [
                {
                  type: "integer",
                },
                {
                  type: "null",
                },
              ],
              default: null,
              title: "Power Level",
            },
            is_locked: {
              anyOf: [
                {
                  type: "boolean",
                },
                {
                  type: "null",
                },
              ],
              default: null,
              title: "Is Locked",
            },
            publish_at: {
              anyOf: [
                {
                  format: "date-time",
                  type: "string",
                },
                {
                  type: "null",
                },
              ],
              default: null,
              title: "Publish At",
            },
            unpublish_at: {
              anyOf: [
                {
                  format: "date-time",
                  type: "string",
                },
                {
                  type: "null",
                },
              ],
              default: null,
              title: "Unpublish At",
            },
          },
          title: "HeroV2Update",
          type: "object",
        },
      },
      fields: [
        {
          name: "id",
          value_type: "integer",
          filter_ops: ["eq", "min", "max", "in"],
          sortable: true,
          choices: null,
          numeric: true,
          categorical: false,
          read_only: true,
          required: false,
        },
        {
          name: "name",
          value_type: "string",
          filter_ops: ["eq", "contains", "icontains", "regex"],
          sortable: true,
          choices: null,
          numeric: false,
          categorical: false,
          read_only: false,
          required: true,
        },
        {
          name: "power_level",
          value_type: "integer",
          filter_ops: ["eq", "min", "max", "in"],
          sortable: true,
          choices: null,
          numeric: true,
          categorical: false,
          read_only: false,
          required: false,
        },
        {
          name: "owner_id",
          value_type: "string",
          filter_ops: ["eq", "contains", "icontains", "regex"],
          sortable: true,
          choices: null,
          numeric: false,
          categorical: false,
          read_only: true,
          required: false,
        },
        {
          name: "is_draft",
          value_type: "boolean",
          filter_ops: ["eq", "in"],
          sortable: true,
          choices: null,
          numeric: false,
          categorical: true,
          read_only: true,
          required: false,
        },
        {
          name: "is_locked",
          value_type: "boolean",
          filter_ops: ["eq", "in"],
          sortable: true,
          choices: null,
          numeric: false,
          categorical: true,
          read_only: false,
          required: false,
        },
        {
          name: "created_at",
          value_type: "datetime",
          filter_ops: ["eq", "min", "max", "in"],
          sortable: true,
          choices: null,
          numeric: false,
          categorical: false,
          read_only: true,
          required: false,
        },
        {
          name: "updated_at",
          value_type: "datetime",
          filter_ops: ["eq", "min", "max", "in"],
          sortable: true,
          choices: null,
          numeric: false,
          categorical: false,
          read_only: true,
          required: false,
        },
      ],
      pagination: {
        style: "offset",
        skip_param: "skip",
        limit_param: "limit",
        sort_param: "sort",
        default_limit: 100,
        max_limit: 1000,
        total: false,
      },
      capabilities: {
        bulk_update: true,
        bulk_delete: true,
        clone: true,
        draft_publish: true,
        archive_restore: true,
        revisions: true,
        events: {
          transport: "sse",
          path: "/crud/v1/heroes/v2/json/events",
          resource: "hero",
          resume_param: "subscriber_id",
          replay: "persistent",
          keepalive_seconds: 15.0,
          actions: ["create", "update", "delete", "restore"],
        },
        stats: true,
        predict: true,
        conditional_requests: true,
        owner_scoped: false,
        schedulable: true,
      },
      paths: {
        filters: "/crud/v1/heroes/v2/json/filters",
        stats: "/crud/v1/heroes/v2/json/stats",
        predict: "/crud/v1/heroes/v2/json/predict",
        revisions: "/crud/v1/heroes/v2/json/revisions",
        clone: "/crud/v1/heroes/v2/json/clone",
        draft: "/crud/v1/heroes/v2/json/draft",
        publish: "/crud/v1/heroes/v2/json/publish",
        restore: "/crud/v1/heroes/v2/json/restore",
        events: "/crud/v1/heroes/v2/json/events",
      },
      bulk: {
        max_matched: 1000,
      },
      auth: {
        scheme: "bearer",
        oidc_discovery_url:
          "http://keycloak:8080/realms/template-fastapi/.well-known/openid-configuration",
        public_read: false,
        read_roles: ["viewer", "editor", "maintainer", "detective"],
        write_roles: ["editor", "maintainer"],
        delete_roles: ["maintainer"],
      },
      cache: {
        etag: true,
        max_age: 0,
        stats_ttl: null,
        stale_while_revalidate: 0,
        list_etag: "weak",
        record_etag: "strong",
        revalidate_only: true,
      },
    },
  ],
};

const base = {
  owner_id: "stub-owner",
  is_draft: false,
  archived_at: null,
  publish_at: null,
  unpublish_at: null,
  is_locked: false,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

export const recordFixtures = [
  {
    ...base,
    id: 1,
    name: "Captain Ledger",
    powers: ["Foresight", "Filing"],
    power_level: 72,
  },
  {
    ...base,
    id: 2,
    name: "The Margin",
    powers: ["Annotation"],
    power_level: 41,
  },
] as const;

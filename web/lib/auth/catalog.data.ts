// Typed copy of docs/auth/permissions.json, the one permission catalog.
// Do not edit by hand: change docs/auth/permissions.json first, then paste it
// here. web/test/auth.test.ts fails when the two differ.

export const CATALOG = {
  "$comment": "The one permission catalog. web/, backend/ and agent/ each embed a copy and a test asserts it equals this file. Change it here first, then every copy, in the same commit. See docs/auth/README.md.",
  "version": 1,
  "resources": {
    "workspace": [
      "read",
      "update",
      "delete"
    ],
    "member": [
      "read",
      "invite",
      "update_role",
      "remove"
    ],
    "billing": [
      "read",
      "manage"
    ],
    "security": [
      "read",
      "manage"
    ],
    "audit": [
      "read"
    ],
    "api_token": [
      "read",
      "create",
      "revoke"
    ],
    "integration": [
      "read",
      "connect",
      "disconnect"
    ],
    "webhook": [
      "read",
      "manage"
    ],
    "brand": [
      "read",
      "update"
    ],
    "playbook": [
      "read",
      "create",
      "update",
      "delete"
    ],
    "content": [
      "read",
      "create",
      "update",
      "delete",
      "approve",
      "publish"
    ],
    "campaign": [
      "read",
      "create",
      "update",
      "launch",
      "pause",
      "delete"
    ],
    "spend": [
      "read",
      "approve",
      "set_limits"
    ],
    "analytics": [
      "read"
    ],
    "agent": [
      "chat",
      "approve"
    ],
    "memory": [
      "read",
      "confirm",
      "forget"
    ]
  },
  "roles": {
    "owner": {
      "label": "Owner",
      "description": "Everything, including deleting the workspace and transferring ownership.",
      "assignable": true,
      "rank": 100,
      "grants": "*"
    },
    "admin": {
      "label": "Admin",
      "description": "Runs the workspace: people, security, billing, integrations and all marketing work. Cannot delete the workspace or make owners.",
      "assignable": true,
      "rank": 80,
      "grants": {
        "workspace": [
          "read",
          "update"
        ],
        "member": [
          "read",
          "invite",
          "update_role",
          "remove"
        ],
        "billing": [
          "read",
          "manage"
        ],
        "security": [
          "read",
          "manage"
        ],
        "audit": [
          "read"
        ],
        "api_token": [
          "read",
          "create",
          "revoke"
        ],
        "integration": [
          "read",
          "connect",
          "disconnect"
        ],
        "webhook": [
          "read",
          "manage"
        ],
        "brand": [
          "read",
          "update"
        ],
        "playbook": [
          "read",
          "create",
          "update",
          "delete"
        ],
        "content": [
          "read",
          "create",
          "update",
          "delete",
          "approve",
          "publish"
        ],
        "campaign": [
          "read",
          "create",
          "update",
          "launch",
          "pause",
          "delete"
        ],
        "spend": [
          "read",
          "approve",
          "set_limits"
        ],
        "analytics": [
          "read"
        ],
        "agent": [
          "chat",
          "approve"
        ],
        "memory": [
          "read",
          "confirm",
          "forget"
        ]
      }
    },
    "marketer": {
      "label": "Marketer",
      "description": "Does the marketing: makes and approves content, launches and pauses campaigns within the caps an admin set, works with the agents.",
      "assignable": true,
      "rank": 60,
      "grants": {
        "workspace": [
          "read"
        ],
        "member": [
          "read"
        ],
        "integration": [
          "read",
          "connect"
        ],
        "webhook": [
          "read"
        ],
        "brand": [
          "read",
          "update"
        ],
        "playbook": [
          "read",
          "create",
          "update",
          "delete"
        ],
        "content": [
          "read",
          "create",
          "update",
          "delete",
          "approve",
          "publish"
        ],
        "campaign": [
          "read",
          "create",
          "update",
          "launch",
          "pause"
        ],
        "spend": [
          "read",
          "approve"
        ],
        "analytics": [
          "read"
        ],
        "agent": [
          "chat",
          "approve"
        ],
        "memory": [
          "read",
          "confirm"
        ]
      }
    },
    "analyst": {
      "label": "Analyst",
      "description": "Reads everything marketing and asks the agents questions. Changes nothing and approves nothing.",
      "assignable": true,
      "rank": 40,
      "grants": {
        "workspace": [
          "read"
        ],
        "member": [
          "read"
        ],
        "integration": [
          "read"
        ],
        "brand": [
          "read"
        ],
        "playbook": [
          "read"
        ],
        "content": [
          "read"
        ],
        "campaign": [
          "read"
        ],
        "spend": [
          "read"
        ],
        "analytics": [
          "read"
        ],
        "agent": [
          "chat"
        ],
        "memory": [
          "read"
        ]
      }
    },
    "billing": {
      "label": "Billing",
      "description": "Manages credits, plans and invoices, and sees spend. No marketing work.",
      "assignable": true,
      "rank": 20,
      "grants": {
        "workspace": [
          "read"
        ],
        "member": [
          "read"
        ],
        "billing": [
          "read",
          "manage"
        ],
        "spend": [
          "read"
        ],
        "analytics": [
          "read"
        ]
      }
    },
    "agent": {
      "label": "Marketer agent",
      "description": "System role for the agent harness acting on a workspace. Never assignable to a person. Its effective permissions are this set intersected with the role of the person who started the session.",
      "assignable": false,
      "rank": 0,
      "grants": {
        "workspace": [
          "read"
        ],
        "integration": [
          "read"
        ],
        "webhook": [
          "read"
        ],
        "brand": [
          "read"
        ],
        "playbook": [
          "read",
          "create",
          "update"
        ],
        "content": [
          "read",
          "create",
          "update",
          "approve",
          "publish"
        ],
        "campaign": [
          "read",
          "create",
          "update",
          "launch",
          "pause"
        ],
        "spend": [
          "read",
          "approve"
        ],
        "analytics": [
          "read"
        ],
        "agent": [
          "chat"
        ],
        "memory": [
          "read"
        ]
      }
    }
  },
  "rules": {
    "grant_ceiling": "A person can invite someone with, or change someone to, only a role whose rank is at most their own. Only an owner can make an owner.",
    "last_owner": "A workspace always has at least one owner: the last owner cannot leave, be removed or be demoted.",
    "self_change": "Nobody can change their own role.",
    "agent_intersection": "Delegated agent calls get agent ∩ the starting person's role. With no verified person, they get the agent role alone, minus anything that moves money (spend:approve, campaign:launch), which then needs a person through the rails.",
    "platform_admin": "Marketer staff (auth.user.role = 'admin') is separate from workspace roles, grants nothing inside a workspace, and requires two-factor to reach /admin.",
    "approval_deciders": "A person may decide an agent approval by id when their role grants agent:approve."
  }
} as const;

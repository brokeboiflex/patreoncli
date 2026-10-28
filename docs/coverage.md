# Coverage and verification

Inspected 2026-10-28. This repository implements posting and community commands with distinct live and fixture verification below. It does not claim every Patreon feature or every write is live verified.

| Workflow | Implementation | Evidence |
| --- | --- | --- |
| Signed-in creator identity | `whoami` | Live command verified the intended browser session |
| Post/draft library | `posts` | Live empty and populated draft-list responses checked; multi-page pagination untested |
| Member list | `members` | Live empty-list response checked; populated membership/pagination untested |
| Read post/draft | `read` | Live reads of empty and populated drafts by numeric ID |
| Comments/replies reading | `comments` | Live read of a public post's JSON:API conversation resources |
| Draft creation and text editing | `draft`, `edit` | Created a private draft; saved and read back title/body changes |
| Publish/delete | `post`, `publish`, `delete-post` | Created and deleted a disposable private draft; publication remains untested |
| Schedule | `schedule` | Schedule toggle/date/time controls inspected and restored; no post scheduled |
| Media | `attach` | Uploaded a 49-byte text attachment; read back media state `ready`; image/audio/video untested |
| Audience/comment/notification settings | Options on `draft`, `post`, `edit` | Free audience, comments disabled, notifications disabled saved and read back on a private draft; paid/tier-specific settings untested |
| Comment/reply/edit/delete | Corresponding write commands | Public comment DOM/menu and help docs inspected; write editor/confirmation still needs an eligible account |
| Moderation reports/moderators/settings | `moderation` | Live empty reports and actual settings read |
| Automatic moderation | `auto-moderation` | Actual switch inspected; no setting changed |
| Community moderators | `moderators`, `add-moderator`, `remove-moderator` | Live empty list; invitation/removal payloads checked against website source and fixtures |
| Blocking | `blocks`, `block`, `unblock` | Live empty list; source-backed write fixtures; no real person blocked |
| Report resolution | `reports`, `resolve-report` | Live empty queue; keep/remove state and readback fixtures |
| Chat identity/channel reads | `chats`, `chat-list`, `chat-settings`, `chat-messages`, `chat-replies`, `chat-members` | Live creator and member token/SDK connection, empty channel lists; populated channel reads untested |
| Chat lifecycle | `create-chat`, `edit-chat`, `delete-chat` | Exact website payloads and fixture tests; live create returned HTTP 403 for unpublished creator account |
| Chat/DM messaging | `send`, `dm`, `edit-message`, `delete-message`, `pin-message`, `unpin-message`, `react`, `mute-user`, `unmute-user` | Website source and official Stream SDK contracts inspected; no eligible channel/member for live sends |

The selected creator page was unpublished, with no members, published posts or chats. Live chat creation returned HTTP 403. Later attempts to access the public post and create another upload draft reached Patreon's browser-verification page and stopped with `BROWSER_VERIFICATION_REQUIRED`; no challenge was bypassed. Publication, scheduling, comment writes, paid/tier-specific post settings, moderator invitations, blocks, report resolution and messages therefore remain unverified live.

The existing attachment test successfully transferred a 49-byte text file and read back media state `ready`; a disposable attachment draft was deleted and absence confirmed. A later PNG test was blocked before draft creation, so image/audio/video upload success is not claimed. One private test draft with the text attachment remains. No creator page was launched, and no public Patreon post, comment, DM, report, block or moderator invitation was sent.

Limits outside these commands: tier-specific post audiences (chat tier audiences are supported), poll/collection editing, rich-text/embedded-media composition, chat file attachments, and full traversal of all channel and admin list pages. No unsupported whole-DM-conversation deletion command is provided. No account IDs, cookies, private snapshots or tokens are checked in.

## Reference details that guided implementation

- [fbcli source](https://github.com/brokeboiflex/fbcli): Bun/TypeScript, flat commands, browser-session import, JSON output, describe, dry-run and explicit write confirmation.
- [Patreon public API](https://docs.patreon.com/): public OAuth post endpoints cover reads, not this full posting/community workflow. This CLI uses the website UI, same-origin JSON requests with browser cookies/CSRF, and the website's chat service.
- [Posting documentation](https://support.patreon.com/hc/en-us/articles/115004048046-Posting-to-your-Patreon): editor, media, audience, notifications and scheduling.
- [Comment settings](https://support.patreon.com/hc/en-us/articles/19789361628045-Comment-settings): per-post access options.
- [Commenting documentation](https://support.patreon.com/hc/en-us/articles/360031098531-Comment-on-a-post): account access constraints and reply flow.
- [Public post inspected](https://www.patreon.com/PatreonforCreators/posts/network-faqs-143425481?l=en-GB): `data-tag=comment-row`, stable comment IDs, comment body/author/menu hooks, and `/api/posts/ID/conversations` responses.
- Current editor source served by Patreon: comment enums `all`, `all_members`, `paid_members`, `none`; notification preference in `post_metadata.send_notifications`; drafts autosave but published posts require explicit saving. The rich text body uses Remirror/ProseMirror document JSON.

`bun run typecheck` and 25 Bun tests passed. Tests cover CLI/confirmation contracts, cookie isolation/formats/decryption, post URL parsing, private draft reads, document text extraction, timezone requirements, and the distinction between a pending media record and completed file transfer. Additional fixtures check moderation, block, report, channel and single-recipient DM requests, permission failures and interrupted writes. These are not live publishing/moderation tests.

- Current moderation/messaging bundles: `/community_moderator` user relationships and assignment deletion; `/blocks` blocked-user relationship without implicit comment deletion; `/stream-chat/message-report/ID` states `kept` and `removed`; `/chat/lounge` audience, campaign/reward relationships and publication; `/conversations` explicit participants followed by `/messages` content.
- Current session helper: CSRF signature comes from `meta[name=csrf-token]`; chat tokens come from `/stream-chat/campaign-token` or `/stream-chat/user-token`. The public production Stream application key was read from the site's production bundle, including its environment selection.
- [Official Stream Chat JavaScript SDK](https://github.com/GetStream/stream-chat-js): user-token connection, channel/message queries, replies, sending, editing/deleting, reactions, pinning and muting. No server secret is used.

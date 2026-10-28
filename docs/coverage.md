# Coverage and verification

Inspected 2026-10-29. This repository implements posting and community commands with distinct live and fixture verification below. It does not claim every Patreon feature or every write is live verified.

| Workflow | Implementation | Evidence |
| --- | --- | --- |
| Signed-in creator identity | `whoami` | Live command verified the intended browser session |
| Post/draft library | `posts` | Live empty and populated draft-list responses checked; multi-page pagination fixture-tested, unverified live |
| Member list | `members` | Live empty-list response checked; populated membership/pagination untested |
| Read post/draft | `read` | Live reads of empty and populated drafts by numeric ID |
| Comments/replies reading | `comments` | Live read of a public post's JSON:API conversation resources |
| Draft creation and text editing | `draft`, `edit` | Created a private draft; saved and read back title/body changes |
| Publish/delete | `post`, `publish`, `delete-post` | Created and deleted a disposable private draft; publication remains untested |
| Schedule | `schedule` | Schedule toggle/date/time controls inspected and restored; no post scheduled |
| Media | `attach` | Uploaded a 49-byte text attachment; read back media state `ready`; image/audio/video untested |
| Audience/comment/notification settings | Options on `draft`, `post`, `edit` | Free audience, comments disabled, notifications disabled saved and read back on a private draft; UI paid/tier controls untested; API audience checks are listed below |
| Selected-tier/paid audiences | `tiers`, `set-audience` | Live selected tier, paid-only and free rules saved/read back on a private draft; restored free afterward |
| Rich document and embeds | `edit-rich`, `edit-embed` | Live formatted heading, paragraph, bold text, bullet list and numbered list saved/read back; link embed resolved. Other supported provider types remain untested live |
| Polls | `edit-poll`, `post-details` | Live private poll created; choices-only editing, response mode, end-time setting/removal saved and read back; vote protections checked in fixtures |
| Collections | `collections`, `collection`, `create-collection`, `edit-collection`, `delete-collection` | Live empty collection creation, metadata/order editing, listing, deletion and absence verification. Draft-post exclusion reproduced and now checked before writes; adding/reordering published posts is fixture-tested |
| Pagination | `--cursor`, `--all`, channel offsets | Lossless small-limit, next-link and meta-cursor fixtures. Live empty moderator/block/report/channel lists; draft-library navigation currently stops at browser verification |
| Chat file upload | `send-attachment` | Byte-transfer-before-send and uncertain-delivery fixtures against the SDK contract; no eligible channel for a live send |
| Comment/reply/edit/delete | Corresponding write commands | Public comment DOM/menu and help docs inspected; write editor/confirmation still needs an eligible account |
| Moderation reports/moderators/settings | `moderation` | Live empty reports and actual settings read |
| Automatic moderation | `auto-moderation` | Live off/on changes and reload verification passed; original enabled state restored. Fixed the asynchronous controlled-switch race that reported failure before the save response arrived |
| Community moderators | `moderators`, `add-moderator`, `remove-moderator` | Live empty list; self-invitation returned HTTP 400 (invalid user). Invitation/removal for another eligible user remains fixture-tested |
| Blocking | `blocks`, `block`, `unblock` | Live empty list and self-block rejection (HTTP 400); source-backed write fixtures; no block was created |
| Report resolution | `reports`, `resolve-report` | Live empty queue; keep/remove state and readback fixtures |
| Chat identity/channel reads | `chats`, `chat-list`, `chat-settings`, `chat-messages`, `chat-replies`, `chat-members` | Live creator and member token/SDK connection, empty channel lists; populated channel reads untested |
| Chat lifecycle | `create-chat`, `edit-chat`, `delete-chat` | Exact website payloads and fixture tests; live create returned HTTP 403 before launch submission and again while the creator account awaited review |
| User muting | `mute-user`, `unmute-user` | Live creator identity muted its own separate member identity; target checked in the response, then unmuted and confirmed absent from the saved mute state |
| Chat/DM messaging | `send`, `dm`, `edit-message`, `delete-message`, `pin-message`, `unpin-message`, `react` | Website source and official Stream SDK contracts inspected; no eligible channel/member for live sends |

The selected creator account has no members, published posts or chats. Its launch was submitted with the owner's approval, but Patreon placed the account under review. A fresh read still returned `published_at: null`, and the inbox stated that messaging requires launching the page. The CLI's unpublished-chat creation was retried in that state and returned `WRITE_REJECTED` (HTTP 403). Attempts to access the public post and create another upload draft reached Patreon's browser-verification page and stopped with `BROWSER_VERIFICATION_REQUIRED`; no challenge was bypassed. Post publication, scheduling, comment writes, moderator invitations, blocks, report resolution and messages therefore remain unverified live. The existing private draft remained editable through the authenticated website API, where audience, rich-content and poll tests ran successfully.

The existing attachment test successfully transferred a 49-byte text file and read back media state `ready`; a disposable attachment draft was deleted and absence confirmed. A later PNG test was blocked before draft creation, so image/audio/video upload success is not claimed. One private test draft with the text attachment, rich content and test poll remains unpublished and unscheduled. Disposable collections were deleted. Creator-page launch was submitted but publication remains pending review. No public Patreon post, comment, DM, report, block or moderator invitation was sent.

Limits outside these commands: arbitrary editor/plugin nodes, inline media composition inside rich JSON, and financial/monetization settings. External embeds use the separate embed command. Existing pagination can only traverse pages the signed-in account is permitted to access. No unsupported whole-DM-conversation deletion command is provided. No account IDs, cookies, private snapshots or tokens are checked in.

## Reference details that guided implementation

- [fbcli source](https://github.com/brokeboiflex/fbcli): Bun/TypeScript, flat commands, browser-session import, JSON output, describe, dry-run and explicit write confirmation.
- [Patreon public API](https://docs.patreon.com/): public OAuth post endpoints cover reads, not this full posting/community workflow. This CLI uses the website UI, same-origin JSON requests with browser cookies/CSRF, and the website's chat service.
- [Posting documentation](https://support.patreon.com/hc/en-us/articles/115004048046-Posting-to-your-Patreon): editor, media, audience, notifications and scheduling.
- [Comment settings](https://support.patreon.com/hc/en-us/articles/19789361628045-Comment-settings): per-post access options.
- [Commenting documentation](https://support.patreon.com/hc/en-us/articles/360031098531-Comment-on-a-post): account access constraints and reply flow.
- [Public post inspected](https://www.patreon.com/PatreonforCreators/posts/network-faqs-143425481?l=en-GB): `data-tag=comment-row`, stable comment IDs, comment body/author/menu hooks, and `/api/posts/ID/conversations` responses.
- Current editor source served by Patreon: comment enums `all`, `all_members`, `paid_members`, `none`; notification preference in `post_metadata.send_notifications`; drafts autosave but published posts require explicit saving. The rich text body uses Remirror/ProseMirror document JSON.

`bun run typecheck` and 36 Bun tests passed with `PATREONCLI_BROWSER` set, including the offline asynchronous-switch regression. Tests cover CLI/confirmation contracts, cookie isolation/formats/decryption, post URL parsing, private draft reads, document text extraction, timezone requirements, and the distinction between a pending media record and completed file transfer. Additional fixtures check moderation, block, report, channel and single-recipient DM requests, permission failures and interrupted writes. These are not live publishing/moderation tests.

- Current moderation/messaging bundles: `/community_moderator` user relationships and assignment deletion; `/blocks` blocked-user relationship without implicit comment deletion; `/stream-chat/message-report/ID` states `kept` and `removed`; `/chat/lounge` audience, campaign/reward relationships and publication; `/conversations` explicit participants followed by `/messages` content.
- Current session helper: CSRF signature comes from `meta[name=csrf-token]`; chat tokens come from `/stream-chat/campaign-token` or `/stream-chat/user-token`. The public production Stream application key was read from the site's production bundle, including its environment selection.
- [Official Stream Chat JavaScript SDK](https://github.com/GetStream/stream-chat-js): user-token connection, channel/message queries, replies, sending, editing/deleting, reactions, pinning and muting. No server secret is used.

- [Collections documentation](https://support.patreon.com/hc/en-us/articles/16666733679757-How-to-use-Collections-to-organize-your-work) and the current collection editor bundle: metadata, ordered `post_ids`, `new_to_old`/`old_to_new`/`custom`, and deletion without deleting posts.
- [Poll documentation](https://support.patreon.com/hc/en-us/articles/360028159232-How-to-poll-your-fans) and the current post payload builder: 2–20 choices, ordered `poll_choice` inclusions, single/multiple response mode, end time, and restrictions after responses/closure.
- Current Remirror extensions and post update builder: supported document nodes/marks, HTML plus `content_json_string`, post access-rule relationships, and `tags.publish: false` with notifications disabled for these updates. Existing relationships are omitted from patches unless explicitly changed.
- [Stream file-upload documentation](https://github.com/GetStream/stream-chat-js/blob/master/docs/fileUpload.md): Node read streams, `sendFile`/`sendImage`, then a message with the returned asset URL. Fixture tests consume real local bytes and verify that an interrupted send is not retried.

## Additional live moderation/chat checks, 2026-10-29

The available creator and member sessions represent one account. Both connected to the real chat service. The creator identity successfully muted and unmuted the account's member identity; a new connection confirmed the final unmuted state. Automatic comment moderation was disabled, enabled, and reloaded to verify both saves; its original enabled setting was restored. The old `setChecked` call asserted the DOM value before Patreon's asynchronous PATCH completed. The command now clicks once, waits for the save response, then verifies a fresh page.

Patreon rejected a self-moderator invitation and self-block with HTTP 400. Creating a self-DM conversation and an unpublished chat returned HTTP 403. After the authorized launch submission, the site displayed an account-review banner, and another unpublished-chat attempt through the CLI still returned HTTP 403. Public-post comment inspection still stopped at browser verification. Successful chat sends, attachments, replies, pinning, reactions, comment writes, moderator assignments, blocks, and report resolution remain unverified live where no permitted target exists. No challenge or permission restriction was bypassed. Launch-form details and account identifiers are excluded from this repository.

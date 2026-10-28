# patreoncli

A Bun CLI and importable TypeScript API following [fbcli](https://github.com/brokeboiflex/fbcli)'s flat commands, browser-session authentication, JSON output, offline `describe`, and `--dry-run` conventions.

**Development version.** Authenticated reads, draft creation/editing/deletion, file attachment, tier audiences, polls, rich text, link embeds, and collection lifecycle have live verification. Moderator/block/report management and chat/DM commands are implemented against inspected website contracts. Their writes still need live verification on a launched creator account with members. See [tested workflows and remaining work](docs/coverage.md).

## Run

Requires Bun and a Chromium-family browser.

```sh
bun install --frozen-lockfile
bun patreoncli.ts --help
bun patreoncli.ts describe --compact
```

Use your Brave default profile on macOS:

```sh
export PATREONCLI_BROWSER="/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"
bun patreoncli.ts whoami --cookies brave
```

`--cookies brave:Default` is equivalent. Other Chromium profiles use `--cookies 'brave:Profile 1'`. Cookie import is opt-in and restricted to this service's domains. macOS may request Keychain access. Linux supports basic Chromium storage; keyring-backed profiles and Windows need an exported cookie/storage-state file.

Alternatively, run `login --browser-path /path/to/browser` in an interactive terminal, finish login manually, and press Enter. The session is stored with mode 0600 under `$XDG_CONFIG_HOME/patreoncli/session.json`, defaulting to `~/.config/patreoncli/session.json`. Later commands use it automatically. `--cookies` takes precedence over the `PATREONCLI_COOKIES` environment variable and saved session. Accepted files: Playwright storage state, JSON cookie arrays/maps, and Netscape exports. Never commit or share these files.

Browser selection: `--browser-path` / `PATREONCLI_BROWSER`, then `--channel` / `PATREONCLI_BROWSER_CHANNEL`, then Playwright's installed Chromium. Use `--headed` if the service requires normal browser verification. The CLI does not bypass verification, log in with your password, or change your existing Brave profile.

## Command contract

- `describe [command]` gives the command schema without browser or network access.
- `--dry-run` validates arguments and prints a plan without browser or network access. It cannot validate account permissions or current UI availability.
- Remote writes prompt in a terminal and require `--yes` in noninteractive use.
- `--body-file file.txt` reads a UTF-8 body instead of a positional text argument.
- Output is one JSON result on stdout; `--compact` emits one line. `--json` is accepted for consistency with fbcli. Diagnostics/errors go to stderr.
- Exit 0 means the command returned its stated result, 1 means an operational failure, 2 means invalid usage. A write result with `status: submitted` records an accepted response, not independent persisted-state verification.
- `WRITE_UNCERTAIN` means inspect the destination before retrying. Writes are never automatically retried. A multi-step command can leave a saved draft or partial change when a later step fails.
- Library functions execute directly; CLI confirmation and dry-run handling are not applied to API calls.

## Examples

```sh
bun patreoncli.ts whoami --cookies brave
bun patreoncli.ts posts --status drafts --cookies brave
bun patreoncli.ts members --limit 50 --cookies brave
bun patreoncli.ts read https://www.patreon.com/CREATOR/posts/POST_ID --cookies brave
bun patreoncli.ts draft --title "Weekly update" --body-file update.txt --cookies brave --yes
bun patreoncli.ts edit DRAFT_ID --comments members --notify off --cookies brave --yes
bun patreoncli.ts attach DRAFT_ID ./cover.png --type image --cookies brave --yes
bun patreoncli.ts publish DRAFT_ID --cookies brave --yes
bun patreoncli.ts schedule DRAFT_ID 2030-01-10T14:00:00+01:00 --cookies brave --yes
bun patreoncli.ts comments https://www.patreon.com/CREATOR/posts/POST_ID --cookies brave
bun patreoncli.ts moderation --tab reported-content --cookies brave
```

`draft` saves without publishing. `post` creates a draft and publishes it. `publish` publishes an existing draft. `edit` changes content/settings and explicitly saves published posts. `delete-post` follows the site's confirmation dialog. An error after draft creation includes its ID/editor URL so it can be resumed instead of duplicated. Numeric IDs work for draft reads and editing; editor URLs are resolved through the signed-in creator.

Post options: `--title`, text/`--body-file`, `--audience free|paid`, `--comments everyone|members|paid|none`, `--notify on|off`. Bodies are plain text entered into the rich-text editor. Existing formatting is replaced when the body is replaced. `attach` supports one image, audio, video, or attachment file on a draft; the command waits until file transfer is complete, though media processing can continue afterward. `schedule` requires a future ISO time with an offset and minute precision, translates it to the browser's timezone, and verifies the saved instant.

Comments support listing, new comments/replies, editing, and deletion where the account has permission. `moderation` reads the reports, moderators, or automatic-moderation tab. `auto-moderation on|off` changes the comment filter, waits for the asynchronous save, and reloads the page to verify persistence. `chats` inspects the inbox. `moderators`, `add-moderator USER_ID`, `remove-moderator ASSIGNMENT_ID`, `blocks`, `block USER_ID`, `unblock BLOCK_ID`, `reports`, and `resolve-report REPORT_ID keep|remove` provide community administration. Adding a moderator sends an invitation. Blocking does not also delete their comments. Report resolution verifies the persisted status.

Chat commands use the same Stream Chat service as Patreon's website, through its official JavaScript SDK. Tokens are obtained from your signed-in Patreon session, used in memory, and never printed or saved. `chat-list` returns your chat identity and channel `cid` values. Creator identities have the form `campaign-CAMPAIGN_ID`; use that campaign ID for chat creation and DMs.

```sh
bun patreoncli.ts chat-list
bun patreoncli.ts chat-list --as member
bun patreoncli.ts create-chat CAMPAIGN_ID --name "Community" --audience all_members --yes
bun patreoncli.ts edit-chat CHANNEL_ID CAMPAIGN_ID --published on --yes
bun patreoncli.ts chat-settings CHANNEL_ID
bun patreoncli.ts chat-messages community_chat_lounge:CHANNEL_ID --limit 50
bun patreoncli.ts chat-members community_chat_lounge:CHANNEL_ID
bun patreoncli.ts send community_chat_lounge:CHANNEL_ID "Hello everyone" --yes
bun patreoncli.ts send community_chat_lounge:CHANNEL_ID "Reply" --reply-to MESSAGE_ID --yes
bun patreoncli.ts chat-replies community_chat_lounge:CHANNEL_ID MESSAGE_ID
bun patreoncli.ts edit-message MESSAGE_ID "Revised message" --yes
bun patreoncli.ts pin-message MESSAGE_ID --yes
bun patreoncli.ts react community_chat_lounge:CHANNEL_ID MESSAGE_ID emoji-1f44d --yes
bun patreoncli.ts dm CAMPAIGN_ID USER_ID "Thanks for your support!" --yes
```

Files and images can be sent with `send-attachment CID ./file.txt "Optional message" --yes`. Use `--type image` for an image, `--mime TYPE` to override detection, and `--reply-to MESSAGE_ID` for a thread. The upload finishes before the message is sent. If delivery becomes uncertain after upload, inspect the channel before retrying; the uploaded file may remain on the service.

Other commands: `delete-chat`, `delete-message`, `unpin-message`, `mute-user`, `unmute-user`, and `react --remove`. Chat/message commands accept `--as creator|member`; creator is the default. Chat lists follow pages up to `--limit` (1–500); `chat-list --all` traverses every available channel and `--offset N` resumes from `nextOffset`. Message/reply/member pages contain up to 100 items. Use `chat-messages --before MESSAGE_ID`, `chat-replies --before REPLY_ID`, and `chat-members --offset N` for older pages. Commands cannot grant membership or exceed the account's permissions.

New chats default to unpublished. Chat audiences are `all_members`, `paid_members`, or `selected_tiers --tiers ID,ID`; `--emoji` sets the channel emoji. Creator chat creation requires access enabled by Patreon; an unpublished creator account can receive HTTP 403. `dm` sends to exactly one explicit user, without a bulk-recipient fallback. Legacy DM conversation deletion is not exposed by Patreon. Editing/deleting individual messages uses channel permissions.

Post/member/comment lists, `collections`, `moderators`, `blocks`, and `reports` return `items`, related `included` resources, and an opaque `cursor` (`next` is an alias). `--limit` caps returned items (1–500). `--cursor TOKEN` resumes within an oversized server page without dropping unused rows; `--all` ignores the limit and follows all pages. `truncated: true` means a continuation is available. Both JSON:API next links and Patreon's `meta.pagination.cursors.next` are supported. Use a cursor with the same list and filters. Lists are live and can change between calls. The original `community.moderators/blocks/reports(browser)` API still returns the raw document; pass `{limit, cursor, all}` to obtain the paginated result.

## Audiences, rich content, polls and collections

These commands update the existing post through the website's same-origin JSON:API and verify the saved fields. They preserve unrelated relationships, do not publish drafts, and request no member notification. Use `publish` separately when ready.

```sh
bun patreoncli.ts tiers CAMPAIGN_ID
bun patreoncli.ts set-audience POST_ID CAMPAIGN_ID tiers --tiers TIER_ID,TIER_ID --yes
bun patreoncli.ts set-audience POST_ID CAMPAIGN_ID paid --yes
bun patreoncli.ts set-audience POST_ID CAMPAIGN_ID free --yes
bun patreoncli.ts post-details POST_ID
bun patreoncli.ts edit-rich POST_ID document.json --yes
bun patreoncli.ts edit-embed POST_ID https://example.com/article --type link --yes
bun patreoncli.ts edit-poll POST_ID poll.json --yes
```

`tiers` returns rewards and their access rules. `set-audience` resolves actual access-rule IDs from that campaign and verifies the post belongs to it. `edit-embed` also accepts `image_embed`, `video_embed`, and `audio_embed` for providers Patreon supports; the service must resolve the URL. Changing an embed's post type can replace an existing poll, as in the site's editor. Only link embedding has live verification.

`edit-rich` replaces the body with a Remirror JSON document. Supported nodes: `doc`, `paragraph`, `text`, `heading` (`attrs.level` 1–6), `bulletList`, `orderedList` (`attrs.order`), `listItem`, `blockquote`, and `hardBreak`. Text marks: `bold`, `italic`, `underline`, `strike`, `code`, and `link` with `attrs.href` (HTTP, HTTPS, or mailto). Other nodes/attributes are rejected rather than silently removed. Inline media nodes are not accepted; use `attach` or `edit-embed` for media. Example `document.json`:

```json
{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Hello members!","marks":[{"type":"bold"}]}]}]}
```

Example `poll.json`:

```json
{"choices":["Tutorial","Behind the scenes"],"multiple":false,"closesAt":null}
```

New polls require 2–20 distinct nonempty choices. Existing polls accept any subset of `choices`, `multiple`, and `closesAt`. `closesAt` is a future ISO timestamp with timezone, saved at second precision; null removes the end time. Polls with responses permit only an end-time change, and closed polls cannot be edited. `post-details` includes the poll, choices, and response counts.

```sh
bun patreoncli.ts collections CAMPAIGN_ID --all
bun patreoncli.ts collection COLLECTION_ID
bun patreoncli.ts create-collection CAMPAIGN_ID --title "Tutorials" --description "Getting started" --yes
bun patreoncli.ts edit-collection COLLECTION_ID --posts POST_ID,POST_ID --order custom --yes
bun patreoncli.ts edit-collection COLLECTION_ID --posts "" --yes
bun patreoncli.ts delete-collection COLLECTION_ID --yes
```

`--posts` replaces the collection's post list, so read it first and include IDs to retain. At most 500 unique published posts are accepted; draft IDs are rejected before writing because the site's picker excludes them. `--order` is `new_to_old`, `old_to_new`, or `custom`. Unspecified collection fields stay unchanged. Deleting a collection preserves its posts. No pricing or collection monetization is changed.

English and Polish UI labels are supported where inspected. Other locales may fail with `UI_CHANGED`. These are unofficial website adapters, not an extension of Patreon's public OAuth API. Community requests use the actual same-origin JSON:API routes and page CSRF signature; basic posting uses the editor UI while the content commands above use its inspected API contracts. They only access content available to the signed-in account.

## TypeScript API

```ts
import { Browser, posts, members, draft, community, content } from "./src/index.ts";

await using browser = await Browser.start("brave", {
  executablePath: "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
});
console.log(await posts(browser, "drafts", 20));
console.log(await members(browser, 20));
console.log(await community.chatList(browser, "creator"));
// content exposes tiers, setAudience, postDetails, editRich, editEmbed, editPoll,
// collections, collection, createCollection, editCollection and deleteCollection.
// Explicit write when you intend to save a draft:
// const saved = await draft(browser, { title: "Weekly update", text: "Hello members!" });
```

## Development and provenance

```sh
bun run typecheck
bun test
# Include the offline asynchronous-switch regression in your installed Chromium:
PATREONCLI_BROWSER=/path/to/browser bun test
```

Without `PATREONCLI_BROWSER`, the one browser regression is skipped. It uses local fixtures, loads no account cookies, and blocks external requests.

The argument parser and browser-cookie reader were adapted from MIT-licensed [brokeboiflex/fbcli](https://github.com/brokeboiflex/fbcli); its copyright notice is retained in LICENSE. Website adapters are separate code based on the referenced services' current UI/source. No account cookies, private page snapshots, or access tokens are included in either package.

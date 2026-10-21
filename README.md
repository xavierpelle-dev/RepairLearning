# RepairLearning

Learn something while Claude works — in English or in French.

> Fork of [Holdtime](https://github.com/ItsRohith-A/holdtime) by Rohith A:
> Python swapped for PHP, about 120 cards per topic instead of 36, and every
> card, label and summary available in French.

When you send Claude Code a prompt, you often wait 30 seconds to a few minutes.
RepairLearning fills that wait with one short card at a time — a quick fact or a
yes/no question — in the band just above your prompt. It picks cards from what
Claude is doing right now, steps aside the moment Claude needs you, and
remembers what you got wrong so it can ask again later.

It ships with cards for JavaScript, PHP and Git, each in English and French, and writes its own for
whatever else you are working on, so a Rust or Kubernetes session gets Rust or
Kubernetes cards.

```
RepairLearning · Git · yes or no?   1: Yes   2: No   9: Hide
Does `git rebase` give the rebased commits new hashes?
```

When Claude finishes, one line under its answer tells you how it went:

```
RepairLearning: 3 cards this turn, 2/2 right · 7/20 today
```

## Why

Waiting on an AI agent creates many short breaks, and most of them end up on a
phone. RepairLearning keeps the break short and useful:

- **Only while Claude works.** Cards appear when a turn starts and disappear
  when it ends. There is no feed to scroll.
- **Claude always comes first.** A permission prompt or a question from Claude
  hides the card at once; it comes back when Claude carries on.
- **About your work.** Editing `.php` files or running `composer` brings PHP
  cards; `git` commands bring Git cards; `cargo` brings Rust and `kubectl`
  brings Kubernetes. Even the first card fits: a `composer.json`,
  `package.json` or `Cargo.toml` in the folder sets the starting topic.
- **It sticks.** Spaced repetition brings a missed question back the next day,
  and correct ones further and further apart.
- **It stops.** At most 5 cards per turn and 20 per day by default.

## Requirements

- **Claude Code v2.1.287 or later.** RepairLearning is a *mod*: it runs inside
  Claude Code and draws in Claude's own window. Check with `claude --version`.
- A terminal (or the desktop app's Code tab). Nothing else to install.

## Install

```bash
claude plugin marketplace add xavierpelle-dev/RepairLearning
claude plugin install repairlearning@repairlearning
```

Restart Claude Code. The next time you give Claude a task, a card appears above
the prompt.

To try a local copy instead:

```bash
git clone https://github.com/xavierpelle-dev/RepairLearning.git
claude --plugin-dir ./repairlearning
```

## How to use it

| Key | What it does |
| --- | --- |
| `1` | Yes, or "Got it" on a fact, or "Next" after an answer |
| `2` | No |
| `9` | Hide cards for the rest of this turn |

Type the digit on its own in the **empty** prompt; it answers the card instead
of starting a prompt. You can also click the buttons, or focus the band with
`Ctrl+X` then `Tab`.

### Commands

| Command | What it does |
| --- | --- |
| `/repairlearning` | Today's count, your accuracy, and accuracy by topic |
| `/repairlearning top` | Your level, XP, streak, best day and badges |
| `/repairlearning share` | One line to paste into Discord or Slack |
| `/repairlearning pause` | Turn cards off (stays off across sessions) |
| `/repairlearning resume` | Turn them back on |
| `/repairlearning reset` | Delete your saved progress and start fresh |

### Levels, streaks and badges

Every card earns XP: 3 for a right answer, 1 for a fact read or a wrong
answer. Levels get further apart as you climb (level 2 at 10 XP, 5 at 160,
10 at 810), and a toast tells you when you reach one. Seeing at least one card
a day keeps your streak going; a whole day without one ends it. A topic earns a
badge once you have answered 20 of its questions with 80% right or better.

`/repairlearning share` prints a line such as

```
RepairLearning · level 7 (412 XP) · streak 12 days · 82% right · badges: PHP, Git
```

to paste into a Discord or Slack channel and compare with friends. Nothing is
sent anywhere: the score stays in the local plugin store with your progress.

### Settings

Change these in `/config`, or when you install:

| Setting | Default | What it does |
| --- | --- | --- |
| Cartes en français (French cards) | Off | Cards, band, summaries and `/repairlearning` replies in French. Progress is kept when you switch |
| Write new cards with a model | On | Cards for topics beyond the three packs. Uses your Claude plan; see [Privacy](#privacy) |
| Daily goal | 20 | Cards per day before RepairLearning goes quiet |
| Cards per turn | 5 | Most cards in one Claude turn |

## What's inside

371 cards ship with RepairLearning, in three topics, half quick facts and half
yes/no questions, each written in English and in French:

| Topic | Cards | Picked when Claude… |
| --- | --- | --- |
| JavaScript and TypeScript | 129 | edits `.js`/`.ts` files, runs `npm`, `node`, `tsc`… |
| PHP | 122 | edits `.php` files, runs `php`, `composer`… |
| Git | 120 | runs `git` or `gh` commands |

With no signal yet, all three topics are mixed. Every shipped card was written
for this project; none are copied from other sites.

### Cards for anything else

RepairLearning recognises Rust, Go, Ruby, Java, Kotlin, Swift, PHP, C#, SQL, Docker,
Kubernetes, Terraform, shell and CSS from the files Claude edits and the
commands it runs. No pack covers those, so RepairLearning asks Claude to write
cards for them in the background and keeps the good ones. With French on,
they are written in French.

A generated card has to clear the same bar as a shipped one — one line, a
question that ends in `?`, a real explanation — or it is thrown away unread.
The shipped packs fill in whenever the library is empty, the request fails, or
you are offline, so the band is never blank waiting on a model.

This is on by default. It uses your Claude plan and sends the topic name to
Claude; nothing from your code or conversation goes with it. Turn it off in
`/config` and RepairLearning makes no network requests at all. See
[PRIVACY.md](PRIVACY.md).

## Privacy

RepairLearning collects no personal data and sends the author nothing. It reads only
the name of each tool Claude uses, the file extension, and the first word of a
shell command, to pick a topic. Your progress is kept in Claude Code's local
plugin store, and `/repairlearning reset` deletes it.

One thing leaves your computer, and only while card writing is on: the topic
name, sent to Claude on your own plan so it can write cards about it. Never
your code, your prompts or Claude's replies. Turn **Write new cards with a
model** off in `/config` and RepairLearning makes no network requests at all. See
[PRIVACY.md](PRIVACY.md).

### Every event RepairLearning handles

A mod sits between Claude Code and what it is about to do, so it is fair to ask
what each hook sees and what it changes. RepairLearning handles eight events. Two of
them change anything at all, and both change only RepairLearning's own output:

| Event | What it reads | What it changes |
| --- | --- | --- |
| `session.start` | Whether a few project files exist, to pick the first topic | Nothing. Registers `/repairlearning` and loads your saved progress |
| `command.run` | Only `/repairlearning`: a matcher limits the hook to that one command, so no other command reaches it | Nothing. It answers its own command with the text you see |
| `turn.start` | That a turn began | Nothing. Picks the first card |
| `tool.call` | The tool's name, a file's extension, the first word of a shell command | Nothing. The call and its result pass through untouched; it never denies, delays or alters a tool call |
| `classic.PermissionRequest` | The tool's name and the one field identifying the call | Nothing — see below |
| `classic.Notification` | That Claude has asked you something | Nothing. Passes the notification on untouched |
| `turn.complete` | The turn's answer and how many cards you saw | Adds one line beneath Claude's answer, the `RepairLearning: 2 cards this turn…` summary. Claude's answer itself is untouched |
| `ui.render` | The band's width, and whether Claude is working | Draws the card in the band above the prompt. It leaves every other part of the screen alone |

`command.run` and `tool.call` are events that are also the names of calls, so a
hook on either could in principle watch or change such a call made by other
code. RepairLearning's `command.run` hook carries the matcher `{ command: 'repairlearning' }`,
so it is never offered another plugin's command, and its `tool.call` hook
returns exactly what `next(e)` gave it.

RepairLearning reads no file contents, no prompts and none of Claude's replies, and
cannot: the only file call it makes is `$.fs.exists`. Besides the band, the one
other thing it puts on screen is a toast the first time you reach the daily
goal. Run `claude plugin validate .claude-plugin/plugin.json` on a clone to see
this list of events, and every call the mod makes, printed from the source.

### The permission hook decides nothing

RepairLearning handles `classic.PermissionRequest`, the event Claude Code raises when
it asks you to approve a tool call. It is worth being plain about this one,
because a hook on that event *could* answer for you. RepairLearning's does not.

**It never allows, denies, or changes a request, and it never answers on your
behalf.** It takes no decision under any condition: there is no branch in it,
no setting that changes it, and no input that makes it behave differently. It
reads two things — the tool's name, and the single field that identifies the
call, such as the command, the path or the URL — writes them to a variable in
memory, and passes the request on unchanged. Every path ends in `return next(e)`,
so the permission prompt you see is exactly the one Claude Code would have
shown without RepairLearning installed.

It exists for one reason: the moment Claude needs you, the card leaves the band,
so the permission prompt has your whole attention instead of competing with a
quiz. The card comes back when the approved call finishes, or when Claude starts
new work. What it noted is never written to disk and never sent anywhere.

The hook is four lines, at the end of `register` in
[hooks/register.tsx](hooks/register.tsx):

```tsx
on('classic.PermissionRequest', async ($, e, next) => {
  await waitForYou($, e.tool_name, keyOf((e.tool_input ?? {}) as Readonly<Record<string, unknown>>))
  return next(e)
})
```

RepairLearning's hook on `classic.Notification` works the same way and for the same
reason: it notices that Claude has asked you something, hides the card, and
passes the notification on untouched.

## Troubleshooting

**No cards appear.** Check `claude --version` is 2.1.287 or newer, that the
plugin is enabled in `/plugin`, and that `/repairlearning` does not say "paused". Cards
only show while Claude is working, and not once today's goal is reached.

**Only JavaScript, PHP and Git cards.** Those are the shipped packs. Cards
for other topics are written in the background and take a few seconds to
arrive; `/repairlearning` shows how many are ready. If it always says `0 generated`,
check **Write new cards with a model** is on in `/config`.

**Typing `1` started a prompt instead of answering.** The digit must be the
only thing in an empty prompt. Otherwise, click the button or focus the band
with `Ctrl+X` then `Tab`.

**A card disappeared mid-question.** Claude asked for permission or a decision.
Answer Claude; the card returns when it continues.

## Development

```bash
claude plugin validate .claude-plugin/plugin.json   # manifest and hooks module
claude plugin test .                                 # the test suite
claude --plugin-dir .                                # run your working copy
```

For editor type checking, run `/plugin-types` once inside Claude Code from
this folder. It writes Claude Code's API types to `.claude/types/`, which
`tsconfig.json` reads and git ignores. Then `npx tsc -p tsconfig.json` checks
the code and the tests.

```
hooks/register.tsx    events and the band: what RepairLearning does in Claude Code
hooks/planner.ts      pure logic: topics, card choice, spaced repetition
hooks/pool.ts         pure logic: the generated library and when to refill it
hooks/text.ts         the band's labels and replies, in English and French
content/*.ts          the card packs
content/generate.ts   the prompt, and turning a model's reply into cards
types/index.d.ts      the shapes of cards and of the band's state
```

A new shipped card is one object in `content/<topic>.ts`. Both shipped and
generated cards go through `isValidCard` in `planner.ts`, so the tests and the
runtime filter agree on what a card has to be: a unique id, one line, a
question that ends with `?`, an answer and an explanation.

Every shipped card also carries an `fr` field with its French text (and
explanation, for a question). The tests check that the French version passes
`isValidCard` too, so a card cannot ship without its translation. Interface
sentences live in `hooks/text.ts`.

Nothing calls a model in the tests. `$.model.complete` is an event like any
other, so `band.test.tsx` answers it with a canned reply.

Raise `version` in `.claude-plugin/plugin.json` for every release so installed
copies update.

## License

MIT — see [LICENSE](LICENSE).

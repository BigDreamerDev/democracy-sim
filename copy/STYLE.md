# How the Realm talks

The game should sound like a sharp friend who happens to run a country: warm, quick, a bit dry. Never like a
form, a bank, or a robot. Read each line out loud. If you wouldn't say it to someone in the group chat, rewrite it.

## The rules

1. **Talk to one person.** "You", not "the user" or "citizens". "Your vote", not "the vote cast".
2. **Use contractions.** "You can't", "it's", "they'll". "You cannot" sounds like a court summons.
3. **Lead with what happens.** "Your bill is law." before "The House voted 4 to 1 and the King signed it."
4. **One idea per sentence.** Two short sentences beat one long one. Over 20 words? Split it.
5. **Plain words.** use, not utilise. start, not commence. before, not prior to. help, not assistance.
6. **Say what to do next.** An error should explain the fix: "Not enough crowns: you have 12, it costs 20."
   not "Insufficient funds."
7. **Buttons are verbs.** "Pass the bill", "Join the Streets", "Copy the link". Sentence case, no full stop.
8. **British English.** Colour, organise, licence (noun), programme. Dates like "Fri 24 Oct".
9. **Curly quotes and apostrophes.** ’ “ ” rather than ' ". (Code needs straight ones; text doesn't.)
10. **Funny, not wacky.** One dry joke beats three exclamation marks. Never mock a player.
11. **No filler.** Cut "please note", "simply", "just", "successfully", "in order to", "currently".
12. **Keep the game's words.** Crowns, Influence, the House, the Gazette, the Streets, the Red Box, ghost,
    the Returning Officer. Don't swap them for "points", "money" or "admin".

## Before and after

| Before | After |
|-|-|
| Action completed successfully. | Done. |
| You do not have sufficient Influence to perform this action. | That costs 15 Influence. You have 9. |
| Please enter a valid username. | Usernames are 3 to 20 letters, numbers or underscores. |
| The proposal has been submitted to the House for consideration. | It’s with the House. Debate opens now. |
| Click here to view the results. | See the results |
| Error: election not found | That election has closed or never existed. |
| Are you sure you want to delete this item? | Remove the passkey “Phone”? You’ll need another way to sign in. |

## Editing on the page

`npm run dev`, open the game, and press **Edit text** (bottom left; bottom right on a wide screen).

- Every line the game knows about gets an outline: amber dashes still to do, teal ones you've rewritten,
  dotted ones you marked fine.
- Click a line to reword it. Your version shows on the page straight away, so you see it in place. Hold
  **Alt** while clicking to use the app normally (follow a link, press a button).
- Parts the game fills in (names, numbers) are kept for you; the box shows them as `${…}`. Keep each one.
- If the same words appear in several places in the code, the editor asks which one you mean.
- **Apply** writes everything into the code and reloads. It all saves to the same `copy/edits.json` as the desk.

- **Lines with versions.** Some lines change with the situation: monarchy or republic, whether you're PM, and
  so on. The editor says when the one you clicked is shown, and lists the other versions under “Which part?”,
  so you can reword them all from one place. **See it as: Queen · King · Republic** on the bar switches the
  demo's government so you can check each version on the page.
- **Lines built from word pieces** (“thing” + “s”) are flagged. Press **Rewrite as whole sentences** to write
  the two versions in full (“3 things are waiting for you” / “One thing is waiting for you”). Apply turns them
  into proper code.

Text that only appears in certain situations (a crisis, an error) is easier to find in the desk.

## Using the desk

`npm run dev`, then open **http://localhost:5173/#/copy**.

- Every string a player can read is listed, grouped by page. The grey line under each one is the source it
  sits in, so fragments ("· asks to") make sense.
- Type a new version in the box. It saves to `copy/edits.json` as you go. Mark lines that are already fine as
  **Fine**, so the count of what's left is honest.
- Lines flagged in amber break a rule above. The flag says which.
- Anything in `${…}` is filled in by the game. Keep every one of them; you can move them around.
- **Apply** writes your edits into the code. Then run `npm run typecheck && npm run smoke` and look at the
  pages you changed in the demo.

From the command line: `npm run copy:extract` refreshes `copy/strings.json`; `npm run copy:apply` applies
`copy/edits.json`. Hand `copy/strings.json` and this guide to Claude to get a first draft of rewrites, then
review them in the desk.

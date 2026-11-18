# Daily digest routine

A scheduled Claude routine can read your numbers each morning, write a short note, and post it to ownbank. ownbank stores it for the day and sends a push notification.

If you skip this, ownbank writes a plain numbers-only digest by itself at 8:15 AM.

## What you need

- Claude connected to ownbank over MCP (see the README).
- A way to run Claude on a schedule, for example a Claude Code routine or a scheduled task.
- Digest posting enabled. It is on by default. `MCP_DIGEST_ENABLED=0` turns it off.

## How the app uses it

The home screen shows the first line as the verdict and up to three bullets as things to do. The numbers come from the app itself, so the note must not repeat or invent figures.

The tools involved:

- `get_digest_data` returns yesterday's spending, month so far, bills due, balances, forecast, safe to spend, budgets and goal.
- `publish_digest` posts the note (markdown, 4000 characters max). Posting again for the same day replaces it.

## Prompt

Schedule this for about 8:00 AM your time:

```text
You are my daily money check for ownbank.

1. Call get_digest_data with no arguments. If sync_status looks stale (more than a day old), say so in the verdict.
2. Write the note in exactly this format and nothing else:

# <one line verdict, 90 characters max, plain words>
- <action 1>
- <action 2>
- <action 3>

Rules:
- The verdict answers "can I spend today?" Lead with the answer, then the reason.
- At most three actions. Skip the list if there is nothing to do.
- Only use numbers returned by the tool. Never invent or estimate a figure.
- No greetings, no emoji, no advice about investing.
- Good actions look like: "Move $65 to savings", "Hold off on dining out until payday", "Rent of $1,200 is due Friday".

3. Call publish_digest with the note as markdown.
```

## Check it works

Run the routine once by hand. Open ownbank, go to Home, and the Today card should show your verdict. Settings > Notifications shows the push that was sent.

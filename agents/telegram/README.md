# Telegram daily stock signals

Standalone background service for the Alpha Nova checkout. No orders, model calls,
paid API, website deployment, or changes to the Jarvis schedule.

## Signal rules

- **Universe:** live Nifty 500 constituent list; unavailable membership stops the scan.
- **Liquidity:** average official NSE traded value over the **20 unique completed
  sessions preceding the signal session**, at least **₹100 crore**. NSE turnover in
  lakhs is divided by 100. Missing sessions exclude the stock. This is traded value,
  not number of shares. Duplicate holiday archive responses are counted once.
- **RSI divergence:** Wilder RSI(14), two strict swing lows or highs, three candles
  on each side of each pivot, at least six sessions apart and at most 60 apart.
  Price must move at least 0.5% to a lower low/higher high while RSI moves at least
  three points in the opposite direction. Fires on the second pivot's confirmation
  date, three completed candles later. Bullish and bearish divergence are separate.
- **Momentum breakout:** daily close above all prior 20 session highs, volume at
  least 1.5 times the prior 20-session average, RSI(14) at least 60, above EMA(50).
- **New 52-week high/low:** session high strictly exceeds, or low strictly falls
  below, the preceding 364-calendar-day extrema. Full-year history is required;
  ties and merely being near an extreme do not qualify. Candle highs/lows are used.

History: two years of Yahoo Finance daily OHLCV through the existing chart module
(Yahoo's split-adjusted quote history, without additional dividend adjustment).
Signals are daily observations, with session dates and the evidence in each message.
No current-day candles are used before 15:45 IST. A report over four days old is not
sent. Missing price history is counted as unavailable rather than a no-match.

## Telegram chats

The configured bot is `@Diana_lovesabot`. Tap **Start** in a private conversation,
add it to a group, or add it as channel administrator with **Post Messages** enabled.
All such chats register automatically; there is no universal `every chat` chat ID.
Bots cannot discover arbitrary chats or message users who never started the bot.
For existing memberships with no pending update, send `/start` or re-add the bot.
Telegram keeps pending updates for at most 24 hours.

Commands: `/start`, `/stop`, `/sample`, `/status`. Group subscription changes require
the sender to be an administrator. Removing/blocking the bot disables delivery.
`/sample` sends real readings, with an explicit TEST heading, and is limited to one
request per minute per chat. Long reports split into formatted HTML messages.
Each newly connected chat automatically receives a TEST copy of the latest fresh
report; its delivered signals are acknowledged so the regular report does not
immediately repeat the same readings.

### Admin subscriber tracking

The owner is private chat **909802034** (override with `TELEGRAM_ADMIN_CHAT_ID`
when starting the service). `/users` is shown in that account's private command
menu. Requests must come from both that private chat and that authenticated sender;
forwarded sender labels, other users, groups, and channels cannot authorize access.

- `/users`: bot subscription totals and each connected channel's live Telegram
  subscriber count, today's joins/exits, and seven-calendar-day observed net growth.
- `/users bot [page]`: private bot users with name, username when available, ID,
  subscription status and first-seen date. Ten records per page.
- `/users <channel_id> [page]`: recorded channel members with name, username when
  available, ID, membership status, join/leave date and invite source when provided.
  Ten records per page, plus today's and seven-day joins/exits and top invite sources.

The polling worker explicitly requests `chat_member` updates. The bot must be a
channel administrator to receive them. The tracker records **future received
membership events**, deduplicates updates, and excludes bot accounts from recorded
join/exit growth. Promotions and ordinary restrictions are not counted as joins or
exits. Dates and day/week boundaries use IST. Removing/rejoining a channel counts
as an exit and another join. An unknown existing member's first observed promotion
does not invent a historical join date.

Telegram's live total may include existing members the bot has never observed and
bot accounts. It is shown separately from recorded people. An unavailable live total
is marked unavailable. The Bot API cannot import the complete existing subscriber
list or identify individual post readers. Growth covers observed events only;
downtime over Telegram's 24-hour pending-update window may leave gaps.

Channel member records and invite attribution stay in the same owner-only local
state file. Daily join/exit aggregates are kept for 90 days. Private bot subscribers
and channel members remain separate, and a channel join never enrolls that person
in private bot messages. Individual records remain available for admin pagination.

The worker uses long polling. It refuses to replace an existing webhook. Another
poller for the same token must be stopped first. API errors never expose token URLs.

Official references: [Telegram Bot API](https://core.telegram.org/bots/api),
[Telegram bot features](https://core.telegram.org/bots/features),
[Bots introduction](https://core.telegram.org/bots).

## Run and operate

The token is stored in macOS Keychain under service `alphanova.telegram.bot`, read
through the existing secret helper. Never put it in frontend code, a tracked file,
or a launchd plist. An explicit `TELEGRAM_BOT_TOKEN` environment variable is also
supported for other hosts.

```sh
npm run telegram -- scan       # compute latest report; no Telegram messages
npm run telegram -- run        # polling + scheduled scans + automatic delivery
npm run telegram -- status     # registered chats and last scan; no token access
npm run telegram -- sample     # send TEST report to every active registered chat
npm run telegram -- users      # send audience overview only to the configured admin
npm run telegram -- users bot  # send private bot subscriber records only to admin
npm run telegram:install       # install/start the macOS login service
```

Initial startup computes the latest completed session. Subsequent scans check every
30 minutes after **18:45 IST, Monday–Friday**, using new published NSE sessions as
the holiday guard. Completed reports reuse the saved result; partial scans retry.
Signals are deduplicated per chat and signal ID and checkpointed after each delivered
chunk. Network delivery followed by a crash before checkpoint can still duplicate a
message. Restarting the service does not ordinarily repeat delivered signals.

The service runs on **this Mac while it is awake and online**. It restarts at login
and after a crash. It is not a hosted 24/7 service. The machine must remain awake for
the evening scan. On wake it catches up to the latest available session within the
four-day freshness window. The checkout and Node installation must remain in place.

Runtime state, reports, subscriptions and delivery checkpoints live in
`outputs/telegram/`, excluded from Git by the existing `outputs/` rule. Files have
owner-only permissions. Set `TELEGRAM_HOME` to change the state location. The token
is not stored there. Corrupt state stops startup rather than silently losing opt-outs.

```sh
# Restart after code changes:
launchctl kickstart -k gui/$(id -u)/in.alphanova.telegram
# Stop:
launchctl bootout gui/$(id -u)/in.alphanova.telegram
```

Logs: `outputs/telegram/service.log` and `service.err.log`. The login service file is
`~/Library/LaunchAgents/in.alphanova.telegram.plist` and contains no credentials.
Run `node --test tests/telegram*.test.js` for scanner, delivery and audience checks.

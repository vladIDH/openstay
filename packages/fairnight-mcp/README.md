# fairnight-mcp

Ask Claude (or any MCP client) about your Fairnight prices:
- "How much is the loft over New Year?"
- "Why is the 9th so cheap?"
- "Which gaps do I have before Christmas?"

This is a read-only [MCP](https://modelcontextprotocol.io) server. It runs on your computer and reads the folder that the [`fairnight` command](https://github.com/vladIDH/openstay/tree/main/packages/fairnight-cli) keeps up to date.

## What it can and cannot do

| Tool | What it answers |
|---|---|
| `list_listings` | Your listings: name, currency, base price, default minimum stay, channels, when the calendars were last read. |
| `get_prices(listing, from, to)` | Price and minimum stay of each night between two dates. Reserved and blocked nights are marked. |
| `explain_night(listing, date)` | Why one night costs what it costs: every factor, with the price before and after. |
| `occupancy(listing, month)` | Nights reserved, blocked and free in a month, the occupancy, and the average price still for sale. |
| `next_gaps(listing, days, maxNights)` | Short free stretches between two stays: the nights that are hardest to sell. |
| `get_sync_status` | Where each listing's data comes from (iCal calendars, Smoobu or Beds24) and when it was last read, with the latest error if any. |
| `get_guest_deadlines(includeDone)` | Guest registration (Fairguest): the communications to the police still due for each stay, with their 24-hour deadline and whether they are late. Only dates and states: guests' details are encrypted, and this server never asks for the passphrase. |

**Nothing writes.** Every tool is declared read-only, and the database is opened in SQLite's read-only mode, so it cannot change prices, calendars or bookings. The server never goes on the internet. It never shows your iCal links, because those work like passwords. To change a price, edit `fairnight.config.json`. To refresh the calendars, run `fairnight sync` or press *Recalculate* on the calendar page.

## Claude Desktop

1. Set up a Fairnight folder first (see [fairnight-cli](https://github.com/vladIDH/openstay/tree/main/packages/fairnight-cli)), then run `fairnight sync` in it.
2. In Claude Desktop open *Settings → Developer → Edit Config*. Add this to `claude_desktop_config.json`, with the path of your folder:

```json
{
  "mcpServers": {
    "fairnight": {
      "command": "npx",
      "args": ["-y", "fairnight-mcp", "--dir", "C:\\Users\\you\\my-rentals"]
    }
  }
}
```

On macOS or Linux the path looks like `/Users/you/my-rentals`.

Until the package is on npm, run it from a clone of this repository after `npm install && npm run build`:

```json
{
  "mcpServers": {
    "fairnight": {
      "command": "node",
      "args": ["C:\\path\\to\\openstay\\packages\\fairnight-mcp\\bin\\fairnight-mcp.js", "--dir", "C:\\Users\\you\\my-rentals"]
    }
  }
}
```

3. Restart Claude Desktop. The seven tools appear under *fairnight*.

The folder can also be given with the `FAIRNIGHT_DIR` environment variable instead of `--dir`.

## License

AGPL-3.0-only. See [LICENSE](LICENSE).

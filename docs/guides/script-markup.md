# Script markup: direct the delivery

Add pauses, change the pace, stress words and fix pronunciations right inside your script. In **Studio**, select some text and use the buttons above the editor:

| Button | Markup | Effect |
|---|---|---|
| **Pause** | `[pause 0.5s]` | A silence. Any length up to 10 s; `[pause 300ms]` works too. |
| **Slower** | `[slow]…[/slow]` | 0.8× speed |
| **Faster** | `[fast]…[/fast]` | 1.2× speed |
| — | `[speed 1.3]…[/speed]` | Any speed from 0.5× to 2×. Speed tags can be nested. |
| **Emphasis** | `*word*` | A touch slower and louder, more expressive on engines with emotion, and set off by tiny pauses |
| **Say as…** | `{SQL|sequel}` | Shows the first part, says the second |

The markup is colour-coded as you type. The **Performance** strip under the script shows how it will be read: each phrase with its speed, emphasis in purple, and pauses in orange. The time estimate includes your pauses.

Your takes keep the clean text (“Our new SQL course…”), not the markup.

Tips:
- Markup is on by default. Turn it off with the **Markup** switch if your script really contains `[brackets]` or `*asterisks*` that should be read out.
- For a word you use often, add it once in **Tools → Pronunciation** instead of `{…|…}` every time.
- The **?** button next to the switch shows this table.

## From the API
Send `"markup": true` with [`POST /v1/speech`](../api/reference/speech.md) or `POST /v1/jobs/speech`. `POST /v1/markup/preview` returns the parsed performance (segments, the clean text and an estimated length) without rendering anything.

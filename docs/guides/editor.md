# Editor

Combine takes, cut out mistakes and polish the result. Nothing you do changes your originals: **Save as take** creates a new take in History.

## Open a take
- In **History**, hover over a take and click the **scissors**.
- Or open **Editor** in the sidebar and click **Add take**. Add as many takes as you like; they play one after another.

Your edit is kept as a draft, even if you quit. **New** clears it.

## The timeline
Each block is a **clip**: a piece of one take. Clips from the same take share a colour.

| To… | Do this |
|---|---|
| Play or pause | **Space**, or the play button. Edits apply while it plays. |
| Move the playhead | Click the ruler or a clip. **← →** nudge by 0.1 s (**⇧** for 1 s). **Home** goes to the start. |
| Cut out a mistake | Put the playhead at its start and press **S**, then at its end and press **S** again. Select the middle clip and press **⌫**. |
| Trim | Drag a clip's left or right edge. For exact times, type them under **Clip**. |
| Reorder | Drag a clip. A blue line shows where it will land. |
| Undo / redo | **⌘Z** / **⇧⌘Z** |
| Zoom | **−** / **+**. **Fit** shows the whole edit. |

## Clip and whole-edit settings
- **Clip gain**: make one clip louder or quieter, from −20 to +12 dB.
- **Fade in / Fade out**: smooth starts and endings.
- **Gap between clips**: insert silence between clips. At 0, clips join with a short **crossfade** (10 ms by default) so joins never click.
- **Overall gain**, and **Normalize**, which brings the loudest peak to −1 dB when you save.

Playback in the editor is instant, so you hear every change right away. Saving renders the same result as a new take (engine “Editor”). You can export it, add it to a project, or edit it again.

## From the API
`POST /v1/takes/edit` renders an edit. See [Takes](../api/reference/takes.md#edit).

# Keystroke overlay (keycast)

The keystroke overlay shows the keys you press as a key-cap badge on the recording
— `Ctrl` `A`, `Ctrl` `Shift` `T`, `⌘` `K` — so a lesson can teach the shortcut
itself instead of only describing it.

It is **opt-in and off by default**, and the recorded keystrokes never leave the
machine: they are written next to the recording, in the same local telemetry file
as the cursor samples. The app has no network reporting.

## Turning it on

**Settings → Cursor → Keyboard shortcuts on screen** (the same *Appearance*
section that holds the cursor style and click effects).

| Option | Default | Meaning |
| --- | --- | --- |
| Enable | off | Records keystrokes and draws the badge. |
| Position | bottom left | `top-left`, `top-center`, `top-right`, `bottom-left`, `bottom-center`, `bottom-right`. |
| Size | 1× (0.5–3×) | Badge height relative to the output width. |
| Opacity | 100 % | Badge opacity, on top of the fade. |
| Display duration | 1600 ms (400–6000) | How long a badge stays at full opacity before it fades. |

The option is also described in the **shortcuts dialog** (Settings → Keyboard
shortcuts) for discoverability; it is a display feature, not a rebindable
shortcut.

## What you see is what you get

The badge is **burned into the exported video from telemetry**, not captured from
the screen — the same route the cursor, click effects, animations and captions
already use:

1. While recording, the existing global input hook writes every keystroke into the
   recording's `*.cursor.json` telemetry file (the file that already holds cursor
   samples).
2. The editor preview draws the badge as DOM from that telemetry.
3. Export burns the badge with the shared canvas renderer.

Because both readers use the same timing model, the preview, the exported MP4 and
the exported GIF agree. The recording HUD also shows the same badge live while you
record, so the presenter can confirm it is working; the HUD is excluded from
screen capture on Windows and macOS during recording, so the live badge is never
duplicated in the final video.

Preview and export deliberately bypass the "native static layout" fast path
(`unsupported-keycast-overlay`), exactly like captions and annotations: that path
composites in native GPU code and cannot draw a badge.

## Behaviour rules

- **A badge needs a real key.** Pressing or holding a modifier alone shows
  nothing; the badge appears when a non-modifier key goes down with, or without,
  modifiers held.
- **Composition.** Modifiers are ordered `Ctrl`, `Alt`, `Shift`, `Meta`, then the
  key, and each token appears once. On macOS the tokens render as `⌃⌥⇧⌘`; on
  Windows and Linux they render as `Ctrl`, `Alt`, `Shift`, `Win`.
- **Direction.** The badge itself is always drawn left-to-right, whatever the
  interface direction is; only its position follows the RTL/LTR layout. Key caps
  therefore never reverse in the Arabic interface.
- **Coalescing.** Consecutive presses of the same combination within 350 ms merge
  into one badge anchored at the newest press, so OS key auto-repeat keeps a
  single badge on screen instead of restarting its timer. Deliberate repeats,
  which are much slower, show a separate badge.
- **Auto-hide.** A badge is painted immediately, holds at full opacity for
  *Display duration*, then fades out linearly over 220 ms. A newer press replaces
  the badge at once.
- **Seeking is deterministic.** The badge is derived from telemetry at the current
  time, so scrubbing backwards shows exactly the badge the export shows.
- **Unknown keys are ignored.** Only mapped key codes produce a badge, so an
  unmapped or media key can never paint a stray label.
- **The app's own capture shortcut is not shown.** The system-wide screenshot
  hotkey is not recorded as a badge.

## Platform support

Keystroke capture reuses the global `uiohook` input hook that already feeds cursor
telemetry. Recordly only starts that hook on **Windows and Linux**; on macOS the
hook's synchronous start can freeze Electron's main thread, so it is skipped and
the cursor comes from the native monitor instead. The badge therefore has no data
to show on macOS until a non-blocking macOS keyboard monitor is added — the
setting is still persisted there so the choice carries over.

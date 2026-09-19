# Retreats color and contrast verification

Reproduced the user's dark headline over the green hero in the site's light appearance. The shared theme also repainted retreat sections and heading wrappers white, while dark appearance made headings in the ivory sections white. The page now keeps its own forest/ivory surfaces and heading inheritance in both appearances. Gallery captions have a consistently dark overlay, and numbered labels use a darker gold.

Only `frontend/src/pages/retreats.css` changed. The connected Retreats Figma hero was aligned to warm ivory `#f8f5ed` by the design agent.

Preview verification applied the exact modified stylesheet to the live page in a browser. All 222 text samples passed at 320, 390, 768, 1440 and 1920 pixels in both light and dark appearances, with no horizontal overflow or page errors. The audit includes headings, body text, lists, captions, buttons, links and expanded FAQ answers. Buttons were also hovered. Frontend typecheck passed.

| Foreground / background | Contrast |
| --- | --- |
| Ivory / forest, or forest / ivory | 12.34:1 |
| Gold / forest | 10.28:1 |
| Hero ivory / brightest possible image under overlay | 7.09:1 |
| Hero gold / brightest possible image under overlay | 5.91:1 |
| Gallery ivory / brightest possible image under overlay | 5.83:1 |
| Lowest measured text pair, olive accent / ivory | 5.27:1 |

`retreat-contrast-preview.json` records this stylesheet preview. The same audit then passed against the deployed page with no CSS injection: `retreat-contrast-live.json` records all 2,220 text checks across ten viewport/theme combinations on release `20260919192607-ec79b4f`. Screenshots labeled “after” show the stylesheet preview; “live” screenshots identify the released result.

The live deployment's four image source labels match the current checkout SHA256 `f3089cb708b1118c8e2ac745391ea12aed9144d7951e3ce56b9238cd5d6f7b66`. Pods are ready with zero restarts, public health reports the exact release, the database container is unchanged, old Compose applications remain stopped, and retention is clean with twelve current/rollback image references. Exact runtime evidence is in `deployment.json`.

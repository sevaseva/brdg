# PBN tooling

Local, uncommitted command-line tools for working with the PBN deal blocks in `_sessions/`.
Downloaded and pinned on 2026-11-18 for use during site work. Nothing here is part of the published
site, and nothing here is loaded by the browser.

| What                | Where                    | Version | License   | Upstream                                              |
| ------------------- | ------------------------ | ------- | --------- | ----------------------------------------------------- |
| `bridge-wrangler`   | `tools/bridge-wrangler/` | 0.11.4  | Unlicense | <https://github.com/bridge-craftwork/bridge-wrangler> |
| `pbn` (Node parser) | `tools/pbn-parser/`      | 1.6.1   | MIT       | <https://github.com/richardschneider/pbn>             |
| `check-pbn.mjs`     | this directory           | —       | ours      | —                                                     |

`tools/` is git-ignored; `check-pbn.mjs` and this file are not.

## bridge-wrangler

Manipulation and conversion. Prebuilt static Linux binary, no toolchain needed.

```bash
PBN=pbn/tools/bridge-wrangler/bridge-wrangler-linux-x86_64

$PBN --help
$PBN filter -i deals.pbn -p "3NT" -m matched.pbn   # filter boards by regex
$PBN rotate-deals -i deals.pbn -o rotated.pbn      # re-seat dealer/declarer
$PBN to-lin -i deals.pbn -o deals.lin              # Bridge Base Online format
$PBN to-pdf -i deals.pbn -o deals.pdf \
  -l declarers-plan --circle-sure-winners          # practice sheet for the class
$PBN event -i deals.pbn -e "Cobb Bridge Club"      # rewrite the Event tag
```

It is lenient: it accepts twelve-card hands, unknown ranks, and missing tags without complaint, so a
successful run does not mean the PBN is correct. It did prove useful once already — it silently
dropped every hand from the LIN export while the ten was written as `10` instead of `T`, which is
the reason the notes use the standard `T`.

## pbn (Node parser)

Strict-ish structural parser. It emits one JSON object per line, so it is the quickest way to see
how a file is being read.

```bash
PBNJS=pbn/tools/pbn-parser/node_modules/.bin/pbn

$PBNJS deals.pbn | grep '"type":"tag","name":"Deal"'
$PBNJS deals.pbn | grep 'Unknown format' || echo "read fine"
```

Two quirks:

- It requires the `% PBN 2.1` directive. Without it the answer is `Unknown format`.
- Its `cards` array splits a `10` rank into `1` and `0`. Use `T` and it is fine.

Neither quirk matters once the deal is standard PBN.

## check-pbn.mjs

The bridge-level checker the other two lack. Node only, no dependencies.

````bash
# from a file
node pbn/check-pbn.mjs deal.pbn

# straight out of a session note (```pbn fence)
sed -n '/^```pbn$/,/^```$/p' _sessions/2026-11-19.md \
  | sed '1d;$d' | node pbn/check-pbn.mjs -

# quiet: no output when everything is fine
node pbn/check-pbn.mjs --quiet deal.pbn
````

It checks:

- tag-line syntax, and text before the first tag
- `Dealer` is N/E/S/W; `Vulnerable` is a known value
- `Deal` starts with a seat and a colon, has four hands of four suits, thirteen cards each, no card
  dealt twice, no unknown or malformed ranks
- `10` is reported as non-standard (write `T`)
- `Auction` contains only legal calls, starts with the dealer, agrees with `Dealer`, and the winning
  bid agrees with `Contract`
- `Declarer` is the first player on the declaring side to bid the denomination
- no `Contract` without an `Auction`

Exit status is 0 when clean, 1 on problems, 2 when a file cannot be read. Anything it cannot judge —
play, scoring, alerts, system agreements — is left alone.

## Reinstalling or upgrading

```bash
# bridge-wrangler
curl -fL https://github.com/bridge-craftwork/bridge-wrangler/releases/latest/download/bridge-wrangler-linux-x86_64.tar.gz \
  | tar -xz -C pbn/tools/bridge-wrangler --strip-components=1

# pbn
npm install --prefix pbn/tools/pbn-parser pbn@1.6.1 --no-fund --no-audit
```

## Adding more tools

Keep this set small. Ask the human first, name the directory under `pbn/`, and say why the existing
tools cannot do the job. Candidates that were considered and not taken: the C# `zdenecek/pbn`
(Windows-only builds, needs .NET and the DDS library) and `Bridge-Parsers` (no release binaries;
needs a Rust toolchain), both of which only duplicate what is already here.

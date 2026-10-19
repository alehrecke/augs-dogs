"""Scrape Explore RI's trail list + each site page into <dir>/sites.json (1 request/sec).

Used 2026-10-19 to build the v2 walk list. To re-check dog rules later:
    mkdir eri && curl -s https://exploreri.org/gtraillist.php -o eri/list.html
    python tools/scrape_exploreri.py eri
then compare eri/sites.json "dogs" flags with tools/walks-source.json (entries carry "eri": siteID).
"""
import html, json, re, sys, time, urllib.request, pathlib

D = pathlib.Path(sys.argv[1])
UA = {"User-Agent": "Mozilla/5.0 (augs-dogs personal research; 1 req/s)"}


def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
        return r.read().decode("utf-8", "ignore")


def text(s):
    s = re.sub(r"<script.*?</script>|<style.*?</style>", "", s, flags=re.S)
    s = html.unescape(re.sub(r"<[^>]+>", "\n", s))
    return re.sub(r"\n\s*\n+", "\n", s)


lst = (D / "list.html").read_text(encoding="utf-8", errors="ignore")
rows = re.findall(r"<tr>\s*<td>([^<]+)</td>\s*<td[^>]*><a href=\"gSiteReport2\.php\?siteID=(\d+)[^\"]*\"><strong>(.*?)</strong></a>(.*?)</td>\s*<td>([^<]*)</td>\s*<td>([^<]*)</td>\s*<td class='icons'>(.*?)</td>", lst, re.S)
print(len(rows), "rows")
out = []
for town, sid, name, extra, miles, diff, icons in rows:
    page_path = D / f"{sid}.html"
    if not page_path.exists():
        page_path.write_text(get(f"https://exploreri.org/gSiteReport2.php?siteID={sid}"), encoding="utf-8")
        time.sleep(1.0)
    p = page_path.read_text(encoding="utf-8", errors="ignore")
    t = text(p)
    # trailhead coordinates appear as lat,lon pairs in direction links
    pairs = re.findall(r"(4[12]\.\d{3,})\s*,\s*(-7[12]\.\d{3,})", p)
    owner = re.search(re.escape(html.unescape(name).strip()) + r"\n[^\n]*?, (?:Co-)?Owners?/Managers?: ([^\n]+)", t)
    what = t.split("What�s There:")[-1] if "What�s There:" in t else t.split("There:")[-1]
    out.append({
        "siteID": int(sid), "name": html.unescape(name).strip(), "town": town.replace(", RI", "").strip(),
        "miles": miles.strip(), "difficulty": diff.strip(),
        "dogs": "Dogs Allowed" in icons, "accessible": "wheelchair" in extra.lower(),
        "hunting": "Hunting is permitted here" in t,
        "owner": owner.group(1).strip() if owner else None,
        "trailheads": [[float(a), float(b)] for a, b in pairs][:6],
        "about": re.sub(r"\s+", " ", what).strip()[:900],
    })
(D / "sites.json").write_text(json.dumps(out, indent=1), encoding="utf-8")
print("dogs:", sum(o["dogs"] for o in out), "no-dogs:", sum(not o["dogs"] for o in out),
      "no coords:", [o["name"] for o in out if not o["trailheads"]])

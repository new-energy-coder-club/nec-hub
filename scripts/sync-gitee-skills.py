#!/usr/bin/env python3
"""sync-gitee-skills.py — 从 Gitee 仓库批量拉取 Skill 目录，导入 nec-hub Skill 中心

用法：
    python scripts/sync-gitee-skills.py                      # 预览（不写 hub）
    python scripts/sync-gitee-skills.py --confirm            # 实际导入
    python scripts/sync-gitee-skills.py --repo owner/name --branch SKill --dir skills

原理：Gitee git/trees API 列出 <dir>/*/SKILL.md → raw URL 逐个抓 frontmatter 描述
→ 分批 POST 到 hub 的 import_skills MCP 工具。
"""
import argparse
import json
import re
import sys
import time
import urllib.request
import urllib.error

def http_get(url: str, retries: int = 3) -> bytes:
    for i in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "nec-hub-skill-sync/1.0"})
            with urllib.request.urlopen(req, timeout=30) as r:
                return r.read()
        except Exception as e:
            if i == retries - 1:
                raise
            print(f"  重试 {i+1}/{retries}: {e}", file=sys.stderr)
            time.sleep(3)
    raise RuntimeError("unreachable")

def parse_description(md: str) -> str:
    """从 SKILL.md frontmatter 提取 description（单行）。"""
    m = re.match(r"^---\s*\n(.*?)\n---", md, re.S)
    if not m:
        return ""
    fm = m.group(1)
    d = re.search(r"^description:\s*[\"']?(.*?)[\"']?\s*$", fm, re.M)
    return (d.group(1) if d else "")[:200]

def mcp_import(hub: str, skills: list[dict], source: str) -> dict:
    body = json.dumps({
        "jsonrpc": "2.0", "id": 1, "method": "tools/call",
        "params": {"name": "import_skills", "arguments": {"skills": skills, "source": source}},
    }, ensure_ascii=False).encode()
    req = urllib.request.Request(f"{hub}/mcp", data=body,
                                 headers={"content-type": "application/json", "User-Agent": "nec-hub-skill-sync/1.0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())

def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", default="darrenpig/new_energy_coder_club")
    ap.add_argument("--branch", default="SKill")
    ap.add_argument("--dir", default="skills")
    ap.add_argument("--hub", default="https://hub.newenergycoder.club")
    ap.add_argument("--confirm", action="store_true", help="实际写入（默认只预览）")
    args = ap.parse_args()

    owner_repo = args.repo
    tree_url = f"https://gitee.com/api/v5/repos/{owner_repo}/git/trees/{args.branch}?recursive=1"
    print(f"== 拉取目录树：{tree_url}")
    tree = json.loads(http_get(tree_url))["tree"]

    skill_md_paths = sorted(
        e["path"] for e in tree
        if e["type"] == "blob"
        and e["path"].startswith(f"{args.dir}/")
        and e["path"].endswith("/SKILL.md")
        and len(e["path"].split("/")) == 3  # skills/<name>/SKILL.md
    )
    print(f"== 发现 {len(skill_md_paths)} 个 SKILL.md")

    skills = []
    for i, path in enumerate(skill_md_paths, 1):
        name = path.split("/")[1]
        raw_url = f"https://gitee.com/{owner_repo}/raw/{args.branch}/{path}"
        page_url = f"https://gitee.com/{owner_repo}/blob/{args.branch}/{path}"
        try:
            md = http_get(raw_url).decode("utf-8", errors="replace")
            desc = parse_description(md)
        except Exception as e:
            print(f"  ⚠️ {name} 抓取失败：{e}")
            desc = ""
        skills.append({"name": name, "description": desc, "url": page_url})
        if i % 20 == 0:
            print(f"  进度 {i}/{len(skill_md_paths)}")
        time.sleep(0.2)  # 友好限速

    if not args.confirm:
        print(f"\n🔍 预览模式，共解析 {len(skills)} 个（--confirm 实际导入）：")
        for s in skills[:10]:
            print(f"  - {s['name']}: {s['description'][:60]}")
        print(f"  ... 以及另外 {max(0, len(skills)-10)} 个")
        return

    # 分批导入（每批 30 个）
    total = 0
    for off in range(0, len(skills), 30):
        batch = skills[off:off + 30]
        resp = mcp_import(args.hub, batch, source="gitee")
        text = resp["result"]["content"][0]["text"]
        print(f"批次 {off//30 + 1}: {text}")
        total += len(batch)
        time.sleep(1)
    print(f"\n✅ 完成，共导入 {total} 个 Skill")

if __name__ == "__main__":
    main()

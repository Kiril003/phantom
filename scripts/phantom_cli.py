#!/usr/bin/env python3
"""PHANTOM OS — Dev CLI (`phantomctl` / `phantom-cli`).

Allows terminal control of workspaces, piping logs directly into messenger,
sending interactive micro-widgets, and triggering webhooks.

Usage:
  phantom_cli.py send "Deploying backend v1.4"
  phantom_cli.py widget --type voting --title "Ready for prod?"
  tail -f /var/log/syslog | phantom_cli.py pipe --title "Server Logs"
  phantom_cli.py webhook --event push --repo "phantom-os"
"""
import argparse
import sys
import time
import json
import urllib.request
import urllib.error

BASE_URL = "http://127.0.0.1:8000/api/v1/work-os"


def post_json(endpoint: str, data: dict):
    url = f"{BASE_URL}{endpoint}"
    req = urllib.request.Request(
        url,
        data=json.dumps(data).encode("utf-8"),
        headers={"Content-Type": "application/json", "User-Agent": "PhantomCLI/1.0"},
    )
    try:
        with urllib.request.urlopen(req, timeout=5) as response:
            res = response.read().decode("utf-8")
            return json.loads(res)
    except urllib.error.URLError as e:
        print(f"❌ [phantom-cli] Connection error to {url}: {e}", file=sys.stderr)
        return None


def cmd_send(args):
    data = {
        "conversation_id": args.channel,
        "text": args.text,
        "kind": "text",
    }
    res = post_json("/cli/send", data)
    if res and res.get("status") == "ok":
        print(f"✨ [phantom-cli] Sent to {args.channel}: {args.text}")
    else:
        print("⚠️ [phantom-cli] Failed to send message")


def cmd_widget(args):
    payload = {}
    if args.type == "voting":
        payload = {
            "id": f"poll_{int(time.time())}",
            "question": args.title or "Командне голосування",
            "options": [
                {"id": "1", "text": "Погоджено (+1)", "votes": 0, "voters": []},
                {"id": "2", "text": "Потрібні правки (-1)", "votes": 0, "voters": []},
            ],
            "totalVotes": 0,
        }
    elif args.type == "kanban":
        payload = {
            "id": f"k_{int(time.time())}",
            "title": args.title or "Спринт завдання",
            "columns": [
                {"id": "1", "title": "To Do", "items": [{"id": "t1", "title": "CLI Task", "priority": "high"}]},
                {"id": "2", "title": "In Progress", "items": []},
                {"id": "3", "title": "Done", "items": []},
            ],
        }
    elif args.type == "raci":
        payload = {
            "id": f"r_{int(time.time())}",
            "title": args.title or "Матриця завдань",
            "roles": ["DevOps", "Backend", "Frontend"],
            "rows": [
                {"id": "r1", "task": "Деплой сервісу", "r": "DevOps", "a": "Lead", "c": "Backend", "i": "Team"}
            ]
        }

    data = {
        "conversation_id": args.channel,
        "kind": f"widget:{args.type}",
        "widget_type": args.type,
        "payload": payload,
    }
    res = post_json("/cli/send", data)
    if res and res.get("status") == "ok":
        print(f"✨ [phantom-cli] Created widget [{args.type}] in {args.channel}")
    else:
        print("⚠️ [phantom-cli] Failed to send widget")


def cmd_pipe(args):
    print(f"📡 [phantom-cli] Streaming stdin to {args.channel}... (Ctrl+C to stop)")
    buffer = []
    last_flush = time.time()

    try:
        for line in sys.stdin:
            buffer.append(line.rstrip())
            if len(buffer) >= 5 or (time.time() - last_flush > 2.0 and len(buffer) > 0):
                chunk = "\n".join(buffer)
                post_json("/cli/send", {
                    "conversation_id": args.channel,
                    "text": f"```\n{chunk}\n```",
                    "kind": "text"
                })
                buffer = []
                last_flush = time.time()
    except KeyboardInterrupt:
        pass

    if buffer:
        post_json("/cli/send", {
            "conversation_id": args.channel,
            "text": f"```\n" + "\n".join(buffer) + "\n```",
            "kind": "text"
        })
    print("🛑 [phantom-cli] Pipe closed.")


def cmd_webhook(args):
    payload = {
        "repository": {"name": args.repo or "phantom-work-os"},
        "sender": {"login": "cli_admin"},
        "commits": [{"id": "a1b2c3d4e5", "message": args.message or "Update core engine", "url": "https://git.local"}],
        "ref": "refs/heads/main"
    }
    url = f"{BASE_URL}/webhooks/default_token"
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "X-GitHub-Event": args.event},
    )
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            print(f"✨ [phantom-cli] Webhook [{args.event}] dispatched: {resp.status}")
    except Exception as e:
        print(f"❌ [phantom-cli] Webhook error: {e}", file=sys.stderr)


def main():
    parser = argparse.ArgumentParser(description="Phantom OS Work OS CLI Controller")
    subparsers = parser.add_subparsers(dest="command")

    # send
    p_send = subparsers.add_parser("send", help="Send text message to channel")
    p_send.add_argument("text", type=str, help="Text content")
    p_send.add_argument("--channel", type=str, default="general", help="Target channel ID")

    # widget
    p_widget = subparsers.add_parser("widget", help="Send micro-widget (kanban, voting, raci)")
    p_widget.add_argument("--type", choices=["kanban", "voting", "raci"], default="voting", help="Widget type")
    p_widget.add_argument("--title", type=str, default="Interactive Widget", help="Title")
    p_widget.add_argument("--channel", type=str, default="general", help="Target channel ID")

    # pipe
    p_pipe = subparsers.add_parser("pipe", help="Pipe stdin logs to channel")
    p_pipe.add_argument("--channel", type=str, default="general", help="Target channel ID")
    p_pipe.add_argument("--title", type=str, default="Piped Logs", help="Title")

    # webhook
    p_wh = subparsers.add_parser("webhook", help="Trigger simulated webhook event")
    p_wh.add_argument("--event", choices=["push", "pull_request", "build"], default="push", help="Event type")
    p_wh.add_argument("--repo", type=str, default="phantom-os", help="Repository name")
    p_wh.add_argument("--message", type=str, default="CI build finished successfully", help="Message")

    args = parser.parse_args()
    if args.command == "send":
        cmd_send(args)
    elif args.command == "widget":
        cmd_widget(args)
    elif args.command == "pipe":
        cmd_pipe(args)
    elif args.command == "webhook":
        cmd_webhook(args)
    else:
        parser.print_help()


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""PHANTOM OS Work OS Developer CLI.

Allows sending messages, triggering digests, posting micro-widgets,
and querying the local knowledge base directly from your terminal.

Usage:
  python3 phantom_cli.py send --chat <id> --text "Hello Team"
  python3 phantom_cli.py kanban --chat <id> --title "Sprint 15"
  python3 phantom_cli.py digest --chat <id>
  python3 phantom_cli.py search --query "architecture"
  python3 phantom_cli.py webhook --token <wh_token> --title "CI/CD Pass"
"""
import argparse
import sys
import json
import urllib.request
import urllib.error

BASE_URL = "http://127.0.0.1:8000/api/v1/work-os"


def post_json(endpoint: str, data: dict):
    url = f"{BASE_URL}{endpoint}"
    req = urllib.request.Request(
        url,
        data=json.dumps(data).encode("utf-8"),
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        print(f"Error {e.code}: {e.read().decode('utf-8')}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"Network error: {e}", file=sys.stderr)
        sys.exit(1)


def get_json(endpoint: str):
    url = f"{BASE_URL}{endpoint}"
    try:
        with urllib.request.urlopen(url) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


def main():
    parser = argparse.ArgumentParser(description="Phantom OS Work OS Developer CLI")
    subparsers = parser.add_subparsers(dest="command", required=True)

    # Command: send
    send_parser = subparsers.add_parser("send", help="Send a message to a workspace conversation")
    send_parser.add_argument("--chat", required=True, help="Conversation ID")
    send_parser.add_argument("--text", required=True, help="Message text")

    # Command: kanban
    kb_parser = subparsers.add_parser("kanban", help="Post an interactive Kanban board widget")
    kb_parser.add_argument("--chat", required=True, help="Conversation ID")
    kb_parser.add_argument("--title", default="Sprint Tasks", help="Kanban Title")

    # Command: digest
    dg_parser = subparsers.add_parser("digest", help="Get or generate a Smart Digest")
    dg_parser.add_argument("--chat", required=True, help="Conversation ID")

    # Command: search
    sr_parser = subparsers.add_parser("search", help="Semantic knowledge base search")
    sr_parser.add_argument("--query", required=True, help="Search query")

    # Command: webhook
    wh_parser = subparsers.add_parser("webhook", help="Send test webhook event")
    wh_parser.add_argument("--token", required=True, help="Webhook channel token")
    wh_parser.add_argument("--title", required=True, help="Event title")
    wh_parser.add_argument("--desc", default="", help="Event description")

    args = parser.parse_args()

    if args.command == "send":
        res = post_json("/cli/send", {"conversation_id": args.chat, "text": args.text, "kind": "text"})
        print(f"✓ Message sent! ID: {res.get('message_id')}")

    elif args.command == "kanban":
        res = post_json(
            "/cli/send",
            {
                "conversation_id": args.chat,
                "kind": "widget:kanban",
                "widget_type": "kanban",
                "payload": {
                    "id": f"kb_{args.title}",
                    "title": args.title,
                    "columns": [
                        {"id": "c1", "title": "To Do", "items": [{"id": "t1", "title": "Initial Task"}]},
                        {"id": "c2", "title": "In Progress", "items": []},
                        {"id": "c3", "title": "Done", "items": []},
                    ],
                },
            },
        )
        print(f"✓ Kanban Board posted! ID: {res.get('message_id')}")

    elif args.command == "digest":
        res = post_json("/digest", {"conversation_id": args.chat, "period": "daily"})
        print(json.dumps(res, indent=2, ensure_ascii=False))

    elif args.command == "search":
        import urllib.parse
        res = get_json(f"/knowledge-search?q={urllib.parse.quote(args.query)}")
        print(f"Found {res.get('count', 0)} matching artifacts:")
        for item in res.get("results", []):
            print(f" • [{item['type'].upper()}] {item['title']} (Score: {item['score']}%)")
            print(f"   {item['snippet']}")

    elif args.command == "webhook":
        res = post_json(f"/webhooks/{args.token}", {"title": args.title, "description": args.desc, "source": "cli"})
        print(f"✓ Webhook delivered: {res.get('status')}")


if __name__ == "__main__":
    main()

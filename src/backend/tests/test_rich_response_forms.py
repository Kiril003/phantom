"""Rich response forms — comparison / timeline / definition / stat (slice 2)."""
from ai.response_formatter import parse_function_call, RESPONSE_FORM_TOOLS


def _tool_names():
    return {t["name"] for t in RESPONSE_FORM_TOOLS}


def test_new_tools_registered():
    assert {"respond_comparison", "respond_timeline",
            "respond_definition", "respond_stat"} <= _tool_names()


def test_parse_comparison():
    form, content, atts = parse_function_call("respond_comparison", {
        "content": "ось порівняння",
        "title": "A vs B",
        "options": ["A", "B"],
        "rows": [{"criterion": "ціна", "values": ["10", "20"], "winner": 0}],
        "recommendation": "бери A",
    })
    assert form == "comparison"
    assert content == "ось порівняння"
    assert atts[0]["type"] == "comparison_data"
    assert atts[0]["data"]["options"] == ["A", "B"]
    assert atts[0]["data"]["recommendation"] == "бери A"


def test_parse_timeline():
    form, _, atts = parse_function_call("respond_timeline", {
        "content": "хронологія",
        "events": [{"title": "крок 1", "status": "done"}],
    })
    assert form == "timeline"
    assert atts[0]["type"] == "timeline_data"
    assert atts[0]["data"]["events"][0]["title"] == "крок 1"


def test_parse_definition():
    form, _, atts = parse_function_call("respond_definition", {
        "term": "симбіоз", "definition": "співіснування",
        "examples": ["лишайник"], "category": "біологія",
    })
    assert form == "definition"
    assert atts[0]["type"] == "definition_data"
    assert atts[0]["data"]["term"] == "симбіоз"
    assert atts[0]["data"]["examples"] == ["лишайник"]


def test_parse_stat():
    form, _, atts = parse_function_call("respond_stat", {
        "value": "42", "label": "відповідь", "unit": "млн",
        "delta": "+12%", "trend": "up", "source": "перепис",
    })
    assert form == "stat_highlight"
    assert atts[0]["type"] == "stat_data"
    assert atts[0]["data"]["value"] == "42"
    assert atts[0]["data"]["trend"] == "up"

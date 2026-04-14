"""One-off helpers to backfill meal preferences on stored registrations."""

from __future__ import annotations

import copy
import json
import re
from typing import Any

ALLOWED_FOOD = frozenset({"Veg", "Non-Veg"})


def resolve_food(raw: object) -> str:
    """Map stored values to Veg / Non-Veg. Missing, hyphen, and unknown → Non-Veg."""
    t = str(raw or "").strip()
    if t in ALLOWED_FOOD:
        return t
    collapsed = re.sub(r"\s+", "", t.lower())
    if collapsed in ("veg", "vegetarian", "v"):
        return "Veg"
    if collapsed in ("non-veg", "nonveg", "nonvegetarian", "nv", "nonvegetarian"):
        return "Non-Veg"
    return "Non-Veg"


def _set_food_on_dict(d: dict[str, Any], changes: list[str], label: str) -> None:
    old = d.get("food", "")
    new_v = resolve_food(old)
    old_s = str(old or "").strip()
    if old_s != new_v:
        d["food"] = new_v
        changes.append(f"{label}: {old_s!r} → {new_v!r}")


def _patch_team_member_list(members: object, changes: list[str], prefix: str) -> list[dict[str, Any]] | None:
    arr: list[Any]
    if isinstance(members, str) and members.strip():
        try:
            parsed = json.loads(members)
        except json.JSONDecodeError:
            return None
        arr = parsed if isinstance(parsed, list) else []
    elif isinstance(members, list):
        arr = members
    else:
        return None

    out: list[Any] = []
    for i, m in enumerate(arr):
        if not isinstance(m, dict):
            out.append(m)
            continue
        row = dict(m)
        _set_food_on_dict(row, changes, f"{prefix}[{i}].food")
        out.append(row)
    return out


def _patch_session_data_block(session: dict[str, Any], changes: list[str]) -> None:
    mu = session.get("mainUser")
    if isinstance(mu, dict):
        mm = dict(mu)
        _set_food_on_dict(mm, changes, "sessionData.mainUser.food")
        session["mainUser"] = mm

    patched_members = _patch_team_member_list(session.get("teamMembers"), changes, "sessionData.teamMembers")
    if patched_members is not None:
        session["teamMembers"] = patched_members


def _patch_events_block(events: dict[str, Any], changes: list[str]) -> None:
    for cat in ("technical", "nonTechnical"):
        block = events.get(cat)
        if not isinstance(block, dict):
            continue
        team = block.get("team")
        if not isinstance(team, dict):
            continue
        members = team.get("members")
        if not isinstance(members, list):
            continue
        new_members: list[dict[str, Any]] = []
        for i, m in enumerate(members):
            if not isinstance(m, dict):
                new_members.append(m)
                continue
            row = dict(m)
            _set_food_on_dict(row, changes, f"events.{cat}.team.members[{i}].food")
            new_members.append(row)
        team["members"] = new_members


def apply_food_patches(record: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
    """
    Return a deep copy of ``record`` with food fields normalized / filled.
    ``ALLOWED_FOOD`` values are kept (after trimming); everything else becomes Veg or Non-Veg.
    """
    data = copy.deepcopy(record)
    changes: list[str] = []

    _set_food_on_dict(data, changes, "food")

    pr = data.get("primaryRegistrant")
    if isinstance(pr, dict):
        pr2 = dict(pr)
        _set_food_on_dict(pr2, changes, "primaryRegistrant.food")
        data["primaryRegistrant"] = pr2

    tm_patched = _patch_team_member_list(data.get("teamMembers"), changes, "teamMembers")
    if tm_patched is not None:
        data["teamMembers"] = tm_patched

    sd_raw = data.get("sessionData")
    if isinstance(sd_raw, dict):
        sd = dict(sd_raw)
        _patch_session_data_block(sd, changes)
        data["sessionData"] = sd
    elif isinstance(sd_raw, str) and sd_raw.strip():
        try:
            parsed = json.loads(sd_raw)
        except json.JSONDecodeError:
            pass
        else:
            if isinstance(parsed, dict):
                sd = dict(parsed)
                _patch_session_data_block(sd, changes)
                data["sessionData"] = sd

    ev = data.get("events")
    if isinstance(ev, dict):
        ev2 = dict(ev)
        _patch_events_block(ev2, changes)
        data["events"] = ev2

    return data, changes

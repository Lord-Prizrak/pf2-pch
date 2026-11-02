#!/usr/bin/env python3
"""Валидатор файлов Block Format v1 (*.block.json / *.sheetdef.json).

Зависимости: только стандартная библиотека Python. Реализует подмножество
JSON Schema draft-07, достаточное для docs/block-format.schema.json
(type, enum/const, required, properties, additionalProperties, pattern,
minLength/minItems/minimum, oneOf/anyOf/allOf/if-then-else, $ref на #/definitions/*).

Использование:
    python3 tools/validate_block.py файл1.json [файл2.json ...]
Код возврата 0 — все файлы валидны, иначе — число ошибок выводится построчно.
"""
import json
import re
import sys

SCHEMA_PATH = "docs/block-format.schema.json"


def resolve_ref(ref, root):
    assert ref.startswith("#"), f"только локальные $ref: {ref}"
    node = root
    for part in ref[2:].split("/"):
        node = node[part.replace("~1", "/").replace("~0", "~")]
    return node


def deref(node, root):
    while isinstance(node, dict) and "$ref" in node:
        merged = dict(resolve_ref(node["$ref"], root))
        merged.update({k: v for k, v in node.items() if k != "$ref"})
        node = merged
    return node


def validate(value, schema, root, path="$", errors=None):
    if errors is None:
        errors = []
    schema = deref(schema, root)
    t = schema.get("type")
    if t:
        types = t if isinstance(t, list) else [t]
        ok = any(
            (ty == "object" and isinstance(value, dict)) or
            (ty == "array" and isinstance(value, list)) or
            (ty == "string" and isinstance(value, str)) or
            (ty == "integer" and isinstance(value, int) and not isinstance(value, bool)) or
            (ty == "number" and isinstance(value, (int, float)) and not isinstance(value, bool)) or
            (ty == "boolean" and isinstance(value, bool)) or
            (ty == "null" and value is None)
            for ty in types
        )
        if not ok:
            errors.append(f"{path}: тип должен быть {t}, а не {type(value).__name__}")
            return errors
    if "const" in schema and value != schema["const"]:
        errors.append(f"{path}: значение должно быть {schema['const']!r}")
    if "enum" in schema and value not in schema["enum"]:
        errors.append(f"{path}: значение вне enum {schema['enum']}")
    if isinstance(value, str):
        if "pattern" in schema and not re.search(schema["pattern"], value):
            errors.append(f"{path}: '{value}' не соответствует паттерну {schema['pattern']}")
        if "minLength" in schema and len(value) < schema["minLength"]:
            errors.append(f"{path}: строка короче minLength={schema['minLength']}")
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if "minimum" in schema and value < schema["minimum"]:
            errors.append(f"{path}: {value} < minimum {schema['minimum']}")
    if isinstance(value, dict):
        for req in schema.get("required", []):
            if req not in value:
                errors.append(f"{path}: отсутствует обязательное поле '{req}'")
        props = schema.get("properties", {})
        addl = schema.get("additionalProperties", True)
        for k, v in value.items():
            if k in props:
                validate(v, props[k], root, f"{path}.{k}", errors)
            elif addl is False:
                errors.append(f"{path}: неизвестное поле '{k}'")
        # if/then/else
        if "if" in schema:
            sub = []
            validate(value, schema["if"], root, path, sub)
            branch = "then" if not sub else "else"
            if branch in schema:
                validate(value, schema[branch], root, path, errors)
    if isinstance(value, list):
        if "minItems" in schema and len(value) < schema["minItems"]:
            errors.append(f"{path}: элементов меньше minItems={schema['minItems']}")
        items = schema.get("items")
        if items:
            for i, v in enumerate(value):
                validate(v, items, root, f"{path}[{i}]", errors)
    for kw in ("allOf", "anyOf", "oneOf"):
        if kw in schema:
            if kw == "allOf":
                for sc in schema["allOf"]:
                    validate(value, sc, root, path, errors)
            else:
                matched = 0
                for sc in schema[kw]:
                    sub = []
                    validate(value, sc, root, path, sub)
                    if not sub:
                        matched += 1
                ok = (matched >= 1) if kw == "anyOf" else (matched == 1)
                if not ok:
                    errors.append(f"{path}: не удовлетворяет {kw} ({len(schema[kw])} вариантов проверки)")
    return errors


def main(argv):
    files = argv[1:] or []
    if not files:
        print(__doc__)
        return 2
    try:
        root = json.load(open(SCHEMA_PATH, encoding="utf-8"))
    except Exception as e:
        print(f"не удалось прочитать схему {SCHEMA_PATH}: {e}")
        return 1
    bad = 0
    for f in files:
        try:
            data = json.load(open(f, encoding="utf-8"))
        except Exception as e:
            print(f"✗ {f}: битый JSON — {e}")
            bad += 1
            continue
        errs = validate(data, root, root, f)
        kind = data.get("kind", "?")
        ident = data.get("id", "?")
        if errs:
            bad += 1
            print(f"✗ {f} ({kind}/{ident}):")
            for e in errs:
                print(f"   • {e}")
        else:
            print(f"✓ {f} ({kind}/{ident}) — валиден")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))

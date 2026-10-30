"""Read-only Python AST discovery for #6303; never import target programs."""
import ast
import json
import sys


CAPABILITIES = {"subprocess", "socket", "os", "pty", "multiprocessing", "asyncio", "ctypes", "importlib"}


def discover(file, source):
    rows = []
    aliases = {}

    def add(node, kind, capability):
        rows.append({"file": file, "line": getattr(node, "lineno", 1),
                     "column": getattr(node, "col_offset", 0) + 1,
                     "kind": kind, "capability": capability})

    try:
        tree = ast.parse(source, filename=file)
    except (SyntaxError, ValueError) as error:
        rows.append({"file": file, "line": getattr(error, "lineno", None) or 1,
                     "column": getattr(error, "offset", None) or 1,
                     "kind": "source-review", "capability": "python-parse-error"})
        return rows

    def bind(name, values):
        known = aliases.setdefault(name, set())
        before = len(known)
        known.update(values)
        if len(known) > 64:
            known.clear()
            known.add("unresolved-alias.*")
            add(tree, "source-review", "python-alias-limit")
        return len(known) != before

    def resolve(node):
        if isinstance(node, ast.Name):
            ambient = {"__import__": "@loader", "eval": "ambient.eval", "exec": "ambient.exec", "compile": "ambient.compile"}
            return aliases.get(node.id, set()) | ({ambient[node.id]} if node.id in ambient else set())
        if isinstance(node, ast.Attribute):
            return {value + "." + node.attr for value in resolve(node.value)}
        if isinstance(node, ast.IfExp):
            return resolve(node.body) | resolve(node.orelse)
        if isinstance(node, ast.Call):
            called = resolve(node.func)
            if called & {"@loader", "importlib.import_module"}:
                if node.args and isinstance(node.args[0], ast.Constant) and isinstance(node.args[0].value, str):
                    return {node.args[0].value}
            if isinstance(node.func, ast.Name) and node.func.id == "getattr" and node.args:
                key = node.args[1].value if len(node.args) > 1 and isinstance(node.args[1], ast.Constant) and isinstance(node.args[1].value, str) else "*"
                return {value + "." + key for value in resolve(node.args[0])}
            return {value + "()" for value in called if value in {"socket.socket", "socket.SocketType"}}
        return set()

    nodes = list(ast.walk(tree))
    for node in nodes:
        if isinstance(node, ast.Import):
            for item in node.names:
                cap = item.name.split(".")[0]
                bind(item.asname or cap, {item.name if item.asname else cap})
                add(node, "capability-import" if cap in CAPABILITIES else "module-review", item.name)
        elif isinstance(node, ast.ImportFrom):
            module = node.module or ""
            cap = module.split(".")[0]
            add(node, "capability-import" if cap in CAPABILITIES else "module-review", module or "relative-module")
            for item in node.names:
                if item.name == "*":
                    add(node, "source-review", "python-star-import:" + module)
                else:
                    bind(item.asname or item.name, {module + "." + item.name})

    for round_number in range(32):
        changed = False
        for node in nodes:
            if isinstance(node, (ast.Assign, ast.AnnAssign)):
                targets = node.targets if isinstance(node, ast.Assign) else [node.target]
                for target in targets:
                    if isinstance(target, ast.Name):
                        changed = bind(target.id, resolve(node.value)) or changed
        if not changed:
            break
        if round_number == 31:
            add(tree, "source-review", "python-alias-analysis-limit")

    for node in nodes:
        if isinstance(node, (ast.List, ast.Tuple, ast.Dict, ast.Set)):
            stored = set()
            for part in ast.walk(node):
                stored.update(value for value in resolve(part) if value.split(".")[0] in CAPABILITIES or value.startswith("ambient."))
            if stored:
                add(node, "source-review", "python-capability-storage:" + " | ".join(sorted(stored)))
        if isinstance(node, ast.Return) and node.value is not None:
            escaped = resolve(node.value)
            if any(value.split(".")[0] in CAPABILITIES or value.startswith("ambient.") for value in escaped):
                add(node, "escape", " | ".join(sorted(escaped)))
        if not isinstance(node, ast.Call):
            continue
        called = resolve(node.func)
        relevant = {value for value in called if value.split(".")[0] in CAPABILITIES or value.startswith("ambient.")}
        if relevant:
            add(node, "call", " | ".join(sorted(relevant)))
        if called & {"@loader", "importlib.import_module"}:
            name = node.args[0].value if node.args and isinstance(node.args[0], ast.Constant) else None
            add(node, "capability-import" if isinstance(name, str) else "dynamic-load", name if isinstance(name, str) else "python-unresolved-module")
        if isinstance(node.func, ast.Name) and node.func.id == "getattr" and node.args and resolve(node.args[0]):
            add(node, "dynamic-load", "python-dynamic-attribute")
        for argument in node.args:
            escaped = resolve(argument)
            if any(value.split(".")[0] in CAPABILITIES or value.startswith("ambient.") for value in escaped):
                add(argument, "escape", " | ".join(sorted(escaped)))
    if not rows:
        add(tree, "source-review", "python-no-classified-capabilities")
    return rows


if __name__ == "__main__":
    documents = json.load(sys.stdin)
    json.dump([row for item in documents for row in discover(item["file"], item["source"])], sys.stdout)

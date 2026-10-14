"""Plugin chạy được khi Hermes nạp từ <HERMES_HOME>/plugins (tên module tổng hợp), không chỉ trong mã Hermes.

Hermes nạp plugin người dùng dưới ``hermes_plugins.<khoá>`` (``hermes_plugins.zalo_tools``,
``hermes_plugins.platforms__zalo``) và provider trí nhớ dưới ``_hermes_user_memory.zalo_memory`` (bản cũ) hoặc
``_hermes_user_memory.zalo_memory__source_<sha16>`` (bản mới). Không có ``plugins.zalo_tools`` hay
``plugins.memory.openviking`` (Hermes mới đã bỏ OpenViking khỏi lõi).

Mỗi kịch bản chạy trong một tiến trình Python riêng, chặn hẳn các tên ``plugins.zalo_tools``,
``plugins.platforms.zalo``, ``plugins.memory.zalo_memory`` và ``plugins.memory.openviking`` — để bản cài cũ
nằm trong mã Hermes của máy chạy test không che mất lỗi.
"""

import json
import os
import subprocess
import sys
import textwrap
import unittest

ROOT = os.path.dirname(os.path.abspath(__file__))
PLUGIN_DIR = os.path.join(ROOT, "hermes-plugin")

PRELUDE = textwrap.dedent(r'''
    import importlib.abc, importlib.util, json, os, sys, types

    BLOCKED = ("plugins.zalo_tools", "plugins.platforms.zalo", "plugins.memory.zalo_memory",
               "plugins.memory.openviking")

    class Block(importlib.abc.MetaPathFinder):
        def find_spec(self, name, path=None, target=None):
            if any(name == b or name.startswith(b + ".") for b in BLOCKED):
                raise ImportError(f"chặn trong test: {name}")
            return None

    sys.meta_path.insert(0, Block())
    PLUGIN_DIR = os.environ["ZALO_PLUGIN_DIR"]

    def namespace(name):
        if name not in sys.modules:
            mod = types.ModuleType(name)
            mod.__path__ = []
            sys.modules[name] = mod
        return sys.modules[name]

    def load(name, folder):
        """Nạp gói plugin như Hermes: tên tổng hợp, có submodule_search_locations để import tương đối chạy."""
        namespace(name.rsplit(".", 1)[0])
        path = os.path.join(PLUGIN_DIR, folder)
        spec = importlib.util.spec_from_file_location(name, os.path.join(path, "__init__.py"),
                                                      submodule_search_locations=[path])
        mod = importlib.util.module_from_spec(spec)
        sys.modules[name] = mod
        spec.loader.exec_module(mod)
        return mod

    out = {}
''')


def run_scenario(body: str) -> dict:
    env = dict(os.environ, ZALO_PLUGIN_DIR=PLUGIN_DIR, PYTHONDONTWRITEBYTECODE="1")
    script = PRELUDE + textwrap.dedent(body) + "\nprint('RESULT=' + json.dumps(out))\n"
    proc = subprocess.run([sys.executable, "-c", script], cwd=ROOT, env=env, capture_output=True,
                          text=True, encoding="utf-8", timeout=120)
    line = next((l for l in proc.stdout.splitlines() if l.startswith("RESULT=")), None)
    if proc.returncode != 0 or line is None:
        raise AssertionError(f"kịch bản lỗi (exit {proc.returncode}):\n{proc.stdout}\n{proc.stderr}")
    return json.loads(line[len("RESULT="):])


class UserDirLayoutTest(unittest.TestCase):
    def test_adapter_finds_tools_loaded_under_hermes_plugins_namespace(self):
        out = run_scenario('''
            tools_pkg = load("hermes_plugins.zalo_tools", "zalo_tools")
            platform = load("hermes_plugins.platforms__zalo", "zalo")
            adapter = sys.modules["hermes_plugins.platforms__zalo.adapter"]
            tools = sys.modules["hermes_plugins.zalo_tools.tools"]
            out["tools_same"] = adapter._zalo_tools() is tools
            out["perms"] = adapter._group_permissions().__name__
            out["people"] = adapter._zalo_people().__name__
            out["toolsets_match"] = [adapter.TOOLSET_OWNER, adapter.TOOLSET_PUBLIC] == [tools.TOOLSET_OWNER, tools.TOOLSET_PUBLIC]
            out["has_register"] = callable(getattr(platform, "register", None))
            out["no_in_tree"] = not any(n.startswith("plugins.zalo_tools") for n in sys.modules)
        ''')
        self.assertEqual(out, {
            "tools_same": True, "perms": "hermes_plugins.zalo_tools.group_permissions",
            "people": "hermes_plugins.zalo_tools.people", "toolsets_match": True, "has_register": True,
            "no_in_tree": True,
        })

    def test_platform_loaded_before_tools_still_imports_and_resolves_later(self):
        # Hermes chỉ coi requires_plugins là gợi ý thứ tự: adapter nạp trước zalo_tools không được hỏng.
        out = run_scenario('''
            load("hermes_plugins.platforms__zalo", "zalo")
            adapter = sys.modules["hermes_plugins.platforms__zalo.adapter"]
            out["perms_before"] = adapter._group_permissions()
            load("hermes_plugins.zalo_tools", "zalo_tools")
            out["perms_after"] = adapter._group_permissions().__name__
            out["tools_after"] = adapter._zalo_tools().__name__
        ''')
        self.assertEqual(out, {"perms_before": None, "perms_after": "hermes_plugins.zalo_tools.group_permissions",
                               "tools_after": "hermes_plugins.zalo_tools.tools"})

    def _memory_scenario(self, module_name: str) -> dict:
        return run_scenario(f'''
            zm = load({module_name!r}, "zalo_memory")
            load("hermes_plugins.zalo_tools", "zalo_tools")
            store = importlib.import_module("hermes_plugins.zalo_tools.memory_store")
            base = sys.modules[zm.OpenVikingMemoryProvider.__module__]
            out["base_module"] = base.__name__
            out["base_compatible"] = zm.base_compatible()
            out["base_registers"] = hasattr(base, "register")
            out["store_finds_provider"] = store._provider_module() is zm
            out["core_openviking_imported"] = "plugins.memory.openviking" in sys.modules
            registered = []
            zm.register(types.SimpleNamespace(register_memory_provider=registered.append))
            out["registered"] = [p.name for p in registered]
        ''')

    def test_memory_provider_under_new_source_namespace_uses_vendored_openviking(self):
        name = "_hermes_user_memory.zalo_memory__source_0123456789abcdef"
        self.assertEqual(self._memory_scenario(name), {
            "base_module": name + ".openviking_base", "base_compatible": True, "base_registers": False,
            "store_finds_provider": True, "core_openviking_imported": False, "registered": ["zalo_memory"],
        })

    def test_memory_provider_under_old_user_namespace(self):
        name = "_hermes_user_memory.zalo_memory"
        out = self._memory_scenario(name)
        self.assertEqual(out["base_module"], name + ".openviking_base")
        self.assertTrue(out["store_finds_provider"])
        self.assertTrue(out["base_compatible"])


class MemoryStoreNameMatchTest(unittest.TestCase):
    def test_provider_module_names(self):
        out = run_scenario('''
            load("hermes_plugins.zalo_tools", "zalo_tools")
            store = importlib.import_module("hermes_plugins.zalo_tools.memory_store")
            names = ["plugins.memory.zalo_memory", "_hermes_user_memory.zalo_memory",
                     "_hermes_user_memory.zalo_memory__source_ab12", "_hermes_user_memory.zalo_memory__source_ab12.openviking_base",
                     "_hermes_user_memory.openviking__source_ab12", "_hermes_user_memory.zalo_memory_extra",
                     "hermes_plugins.zalo_memory"]
            out["match"] = [n for n in names if store._is_provider_module_name(n)]
        ''')
        self.assertEqual(out["match"], ["plugins.memory.zalo_memory", "_hermes_user_memory.zalo_memory",
                                        "_hermes_user_memory.zalo_memory__source_ab12"])


class ManifestTest(unittest.TestCase):
    def _manifest(self, folder):
        import yaml
        with open(os.path.join(PLUGIN_DIR, folder, "plugin.yaml"), encoding="utf-8") as fh:
            return yaml.safe_load(fh)

    def test_manifest_names_and_kinds(self):
        platform = self._manifest("zalo")
        # "zalo-platform" là tên một plugin Zalo khác trong danh mục Hermes — không được trùng.
        self.assertEqual(platform["name"], "2anh-zalo-platform")
        self.assertEqual(platform["kind"], "platform")
        self.assertEqual(platform["requires_plugins"], ["zalo-tools"])
        self.assertEqual(self._manifest("zalo_tools")["name"], "zalo-tools")
        memory = self._manifest("zalo_memory")
        self.assertEqual((memory["name"], memory["kind"]), ("zalo_memory", "exclusive"))

    def test_third_party_imports_are_declared(self):
        # Hermes mới chạy trong môi trường do `hermes pm` dựng: chỉ có thư viện của Hermes + python_dependencies.
        # Thiếu khai báo (vd. pyyaml) thì plugin không nạp được, bot Zalo tắt hẳn.
        import ast
        local = {"zalo", "zalo_tools", "zalo_memory", "gateway", "hermes_cli", "hermes_constants", "agent", "tools",
                 "plugins", "hermes_plugins", "model_tools", "toolsets", "utils", "run_agent", "cron", "tts"}
        pip_name = {"yaml": "pyyaml", "PIL": "pillow", "pillow_jxl": "pillow-jxl-plugin", "docx": "python-docx",
                    "pptx": "python-pptx", "fpdf": "fpdf2", "fitz": "pymupdf", "pymupdf": "pymupdf",
                    "yt_dlp": "yt-dlp", "youtube_transcript_api": "youtube-transcript-api"}
        declared = {d.split("[")[0].lower() for d in self._manifest("zalo")["python_dependencies"]}
        missing = set()
        for folder in ("zalo", "zalo_tools", "zalo_memory"):
            for dirpath, _, files in os.walk(os.path.join(PLUGIN_DIR, folder)):
                for name in files:
                    if not name.endswith(".py") or name.startswith("test_"):
                        continue
                    with open(os.path.join(dirpath, name), encoding="utf-8") as fh:
                        tree = ast.parse(fh.read())
                    for node in ast.walk(tree):
                        if isinstance(node, ast.Import):
                            mods = [a.name for a in node.names]
                        elif isinstance(node, ast.ImportFrom) and not node.level and node.module:
                            mods = [node.module]
                        else:
                            continue
                        for mod in mods:
                            top = mod.split(".")[0]
                            if top in sys.stdlib_module_names or top in local or top.startswith("_"):
                                continue
                            if pip_name.get(top, top).lower() not in declared:
                                missing.add(f"{top} ({folder}/{name})")
        self.assertEqual(sorted(missing), [], "thêm vào python_dependencies trong hermes-plugin/zalo/plugin.yaml")


if __name__ == "__main__":
    unittest.main()

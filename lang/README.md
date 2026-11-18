# Language files / 语言文件

English | [简体中文](#简体中文)

The interface is written in Simplified Chinese, which is built into the app. Every other language is an external `.lang` file in this folder (in the installed app: the `lang` folder next to `ysm-preview.exe`). The app lists every valid `.lang` file in the language menu of the top bar.

## File format

A `.lang` file is UTF-8 JSON:

```json
{
  "language": {
    "code": "en",
    "name": "English",
    "nativeName": "English",
    "author": "Your name",
    "appVersion": "1.0.14"
  },
  "strings": {
    "main": {
      "未加载模型": "No model loaded",
      "已适配 {0} 个模组": "{0} mod(s) supported"
    },
    "library/library-view": {
      "模型库": "Library"
    }
  }
}
```

- `language.code` (required): a language tag such as `en`, `ja`, `ko`, `zh-TW`. When nothing has been chosen yet, the app picks the file matching the system language.
- `language.nativeName`: shown in the language menu; `name` is shown below it when different.
- `strings`: the **key is the original Chinese text** and the value is its translation. Entries are grouped by the source file they come from (`main`, `library/library-view`, …); the groups only help translators, the app merges them.
- An empty value (`""`) means "not translated yet" — that text stays in Chinese.
- `{0}`, `{1}`… are filled in by the app (numbers, names…). Keep every placeholder; you may move them to fit the word order.
- Keep HTML entities such as `&lt;` and `&gt;` as they are.
- `obsolete` (added by the sync tool) holds translations whose Chinese text no longer exists in the app; you can delete it.

## Adding a language

1. Copy `en.lang` to a new file, e.g. `ja.lang`.
2. Change the `language` block.
3. Replace every English value with your translation (the Chinese keys are the source text).
4. Put the file in the `lang` folder and pick the language in the top bar (the menu also has "Open language folder" in the desktop app).

## For developers

UI strings are wrapped in `tr('中文', ...args)` in `src/`. After adding or changing UI text, run:

```sh
npm run lang             # sync every lang/*.lang with the source
npm run lang -- --missing  # also list the untranslated entries
```

It adds new keys with an empty value, moves removed keys to `obsolete`, and lists any Chinese text in the source that is not wrapped in `tr()`.

---

## 简体中文

界面原文为简体中文，内置在软件中；其他语言都是本文件夹中的外置 `.lang` 文件（安装后位于 `ysm-preview.exe` 旁的 `lang` 文件夹）。顶栏的语言菜单会列出所有有效的 `.lang` 文件。

- 文件为 UTF-8 编码的 JSON，结构见上方示例。
- `language.code` 必填（如 `en`、`ja`、`zh-TW`）；`nativeName` 显示在语言菜单中。
- `strings` 中**键是中文原文，值是译文**；按来源文件分组（`main`、`library/library-view` 等），分组只为方便翻译，软件会合并读取。
- 值为空字符串表示尚未翻译，该处继续显示中文。
- `{0}`、`{1}` 等占位符由软件填入数字或名称，必须保留，可按目标语言语序调整位置；`&lt;`、`&gt;` 等 HTML 实体原样保留。
- 新增语言：复制 `en.lang`，修改 `language` 信息，逐条替换译文，放进 `lang` 文件夹后在顶栏切换（桌面版菜单里有“打开语言文件夹”）。
- 开发者修改界面文字后运行 `npm run lang` 同步所有语言文件（新增条目留空、删除的条目移入 `obsolete`，并列出源码中没有用 `tr()` 包裹的中文）。

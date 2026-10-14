# Job Dating · 个人校招投递看板

查招聘、按 DDL 安排行动，并记录每条机会的投递进度。保留原有的玻璃质感界面、搜索和筛选，增加每日数据同步与本机自动保存。

## 在这台电脑上使用

双击项目中的 **`启动 Job Dating.cmd`**，等待浏览器打开 `http://127.0.0.1:4188`。之后可以收藏这个地址；电脑重启后再运行启动文件。无需直接打开 `dist/index.html`。

启动脚本会生成网页并启动本地服务；重复运行会复用已启动的服务。只监听本机回环地址，手机不能直接通过此地址访问电脑。

本机需要 Node.js 和 Python 3.12 或以上版本。当前电脑已具备环境；脚本优先使用已安装的 Codex Python，其他电脑可使用 PATH 中的 Python。无需安装第三方 Python 包或 npm 包。

## 使用方式

- **当日新增 / 3 天内新增 / 一周内新增**：与搜索、城市、届次等条件组合使用。3 天和一周分别包含今天及之前 2 / 6 个北京时间自然日。
- **DDL 排序**：明确的未过期截止日期优先；“尽快投递”“招满即止”等保留原意，不编造日期。
- **我的投递记录**：点开公司详情，选择未开始、填写中、已投递、笔试、面试、Offer 或不再考虑；可以填写日期和备注。标为已投递时，空的投递日期默认填今天。
- **自动保存**：状态立即提交，备注在停顿约 350 毫秒或离开输入框时提交。看到“已保存”表示本地数据库已确认写入。打开招聘链接不会自动标记已投。
- **备份**：页面底部“导出投递记录”生成 JSON。换电脑时可用“恢复缺失记录”导入；已有记录保留，导入不会覆盖它们。

已收藏或已有进度的记录，即使截止或从源表移除，仍可在对应个人视图中查看。

## 每日更新

本机已配置 Windows 计划任务 `JobDating-DailyRefresh`，每天 **09:17** 运行一次。当前电脑使用中国标准时间；任务按 Windows 本地时间运行。电脑开机且用户已登录时执行，错过时会在系统可运行后补执行；启动网页服务也会检查当天是否更新并补抓取。网页打开期间会检查同步状态，不需要手动刷新整页。

可点击“同步招聘信息”手动更新。同步失败时保留上次完整数据和个人记录。同步状态保存在 `data/sync-status.json`，抓取历史保存在 `private/catalog-history/`。

“新增”指**本工具首次发现**该记录，不代表公司首次发布的准确时间。原始基线中的 7,788 条记录没有可靠的首次发现时间，不会全部被误标为当天新增；后续修改或重新出现的旧记录保留原首次发现时间。

数据来源由运行环境私密配置。适配器检查列结构、分页总数、记录 ID 和表格版本；来源访问方式或字段改变时停止更新并保留上次数据。最新招聘状态以招聘单位原公告为准。

本地在不进入 Git 的 `private/source.json` 中配置 `url`，或使用环境变量 `RECRUITMENT_SOURCE_URL`。云端在仓库 Settings → Secrets and variables → Actions 添加同名 Secret。不要将真实来源地址写入源码、示例、README、命令行参数或日志。前端只读取处理后的数据，不向来源发请求。

发布前会检查源码、数据、构建产物和 Git 历史是否包含配置中的来源标识；检查失败则停止发布。公开页面展示的招聘信息本身仍可被访客读取，私密配置只保护来源地址。

在另一台 Windows 电脑注册任务（Python 路径需改为实际路径）：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install-daily-task.ps1 -PythonExe "C:\path\to\python.exe"
```

## 数据放在哪里

| 内容 | 路径 | 是否进入 Git |
| --- | --- | --- |
| 招聘目录与首次发现时间 | `data/catalog.json` | 是 |
| 你的状态、收藏、投递日期、备注 | `private/progress.sqlite3` | 否 |
| 抓取历史、服务日志 | `private/` | 否 |
| 本机数据来源配置 | `private/source.json` | 否 |
| 生成的网页 | `dist/` | 否，部署时重新构建 |
| 测试数据和截图 | `qa/` | 否 |

个人进度与招聘数据分开保存，更新招聘数据不会覆盖进度。清理浏览器缓存也不会删除本机 SQLite 记录。请保留项目的 `private/` 目录，并定期导出备份。旧演示网页的浏览器记录受来源地址限制，不能自动跨地址读取。

## GitHub 与在线地址

项目包含 GitHub Actions 发布和每日更新配置。

先设置 `RECRUITMENT_SOURCE_URL` Secret，再推送仓库，并在 Settings → Pages 中选择 GitHub Actions：

- `pages.yml`：推送 `main` 或手动运行后构建并发布网页。
- `daily-refresh.yml`：每天 UTC 01:17（北京时间 09:17）更新招聘目录、检查、提交并重新部署。GitHub 定时任务可能延迟，且需确认云端运行器能够访问来源。

GitHub Pages 是静态网站：在线版本的投递记录保存在**访问它的那个浏览器**，支持导出备份，不会自动同步本机 SQLite 或手机记录。要继续使用本机数据库，请使用本地启动文件。仓库和 Pages 不应包含 `private/` 或个人备份文件。

参考：[GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)、[定时工作流](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)。实际发布和更新结果以 Actions 运行状态为准。

## 开发与检查

```powershell
node build.cjs
node --test tests/core.test.cjs
python -m unittest discover -s tests -p "test_*.py"
python -X utf8 scripts/server.py
```

手动抓取：`python -X utf8 scripts/sync.py`。只在今天尚未更新时抓取：追加 `--if-due`。

核心逻辑覆盖新增日期、DDL 排序、记录持久化、并发修改冲突、备份恢复、来源异常保留旧数据，以及本地 API 的来源与私有文件访问控制。
